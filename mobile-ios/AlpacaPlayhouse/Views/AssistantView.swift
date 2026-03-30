import SwiftUI
import Speech
import AVFoundation

// MARK: - Models

struct ChatMessage: Identifiable {
    let id = UUID()
    let text: String
    let isUser: Bool
    let timestamp: Date
}

// MARK: - ViewModel

@Observable
class AssistantViewModel {
    var messages: [ChatMessage] = []
    var conversationId: String?
    var isLoading = false
    var isListening = false
    var inputText = ""
    var errorMessage: String?

    private let haosService = HaosService()
    private let speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private let audioEngine = AVAudioEngine()

    func sendMessage() {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        inputText = ""
        let userMessage = ChatMessage(text: text, isUser: true, timestamp: Date())
        messages.append(userMessage)
        isLoading = true
        errorMessage = nil

        Task {
            do {
                let response = try await haosService.sendMessage(
                    text: text,
                    conversationId: conversationId
                )
                await MainActor.run {
                    self.conversationId = response.conversationId
                    let assistantMessage = ChatMessage(
                        text: response.speech,
                        isUser: false,
                        timestamp: Date()
                    )
                    self.messages.append(assistantMessage)
                    self.isLoading = false
                }
            } catch {
                await MainActor.run {
                    self.errorMessage = error.localizedDescription
                    let errorMsg = ChatMessage(
                        text: "Error: \(error.localizedDescription)",
                        isUser: false,
                        timestamp: Date()
                    )
                    self.messages.append(errorMsg)
                    self.isLoading = false
                }
            }
        }
    }

    func newConversation() {
        messages.removeAll()
        conversationId = nil
        errorMessage = nil
    }

    // MARK: - Voice Input

    func toggleListening() {
        if isListening {
            stopListening()
        } else {
            startListening()
        }
    }

    private func startListening() {
        guard let speechRecognizer = speechRecognizer, speechRecognizer.isAvailable else {
            errorMessage = "Speech recognition not available"
            return
        }

        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            DispatchQueue.main.async {
                guard status == .authorized else {
                    self?.errorMessage = "Speech recognition not authorized"
                    return
                }
                self?.beginRecording()
            }
        }
    }

    private func beginRecording() {
        // Cancel any existing task
        recognitionTask?.cancel()
        recognitionTask = nil

        let audioSession = AVAudioSession.sharedInstance()
        do {
            try audioSession.setCategory(.record, mode: .measurement, options: .duckOthers)
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            errorMessage = "Audio session error: \(error.localizedDescription)"
            return
        }

        recognitionRequest = SFSpeechAudioBufferRecognitionRequest()
        guard let recognitionRequest = recognitionRequest else { return }
        recognitionRequest.shouldReportPartialResults = true

        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)

        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { buffer, _ in
            recognitionRequest.append(buffer)
        }

        audioEngine.prepare()
        do {
            try audioEngine.start()
            isListening = true
        } catch {
            errorMessage = "Audio engine error: \(error.localizedDescription)"
            return
        }

        recognitionTask = speechRecognizer?.recognitionTask(with: recognitionRequest) { [weak self] result, error in
            DispatchQueue.main.async {
                if let result = result {
                    self?.inputText = result.bestTranscription.formattedString
                }
                if error != nil || (result?.isFinal ?? false) {
                    self?.stopListening()
                    // Auto-send if we got a final result
                    if result?.isFinal == true, let text = self?.inputText,
                       !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        self?.sendMessage()
                    }
                }
            }
        }
    }

    private func stopListening() {
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        recognitionRequest?.endAudio()
        recognitionRequest = nil
        recognitionTask?.cancel()
        recognitionTask = nil
        isListening = false
    }
}

// MARK: - View

struct AssistantView: View {
    @State private var viewModel = AssistantViewModel()

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Subtitle
                Text("Powered by HAOS + Ollama")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.top, 4)

                // Chat messages
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 12) {
                            ForEach(viewModel.messages) { message in
                                ChatBubble(message: message)
                                    .id(message.id)
                            }
                            if viewModel.isLoading {
                                HStack {
                                    ProgressView()
                                        .padding(.horizontal, 16)
                                        .padding(.vertical, 10)
                                        .background(Color(.systemGray5))
                                        .clipShape(RoundedRectangle(cornerRadius: 16))
                                    Spacer()
                                }
                                .padding(.horizontal, 16)
                                .id("loading")
                            }
                        }
                        .padding(.vertical, 12)
                    }
                    .onChange(of: viewModel.messages.count) {
                        withAnimation {
                            if viewModel.isLoading {
                                proxy.scrollTo("loading", anchor: .bottom)
                            } else if let last = viewModel.messages.last {
                                proxy.scrollTo(last.id, anchor: .bottom)
                            }
                        }
                    }
                }

                Divider()

                // Input bar
                HStack(spacing: 12) {
                    TextField("Ask your assistant...", text: $viewModel.inputText)
                        .textFieldStyle(.roundedBorder)
                        .submitLabel(.send)
                        .onSubmit {
                            viewModel.sendMessage()
                        }

                    Button {
                        viewModel.sendMessage()
                    } label: {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.title2)
                            .foregroundStyle(AppTheme.accent)
                    }
                    .disabled(viewModel.inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || viewModel.isLoading)

                    Button {
                        viewModel.toggleListening()
                    } label: {
                        Image(systemName: viewModel.isListening ? "mic.fill" : "mic")
                            .font(.title2)
                            .foregroundStyle(viewModel.isListening ? .red : AppTheme.accent)
                            .symbolEffect(.pulse, isActive: viewModel.isListening)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
            }
            .background(AppTheme.light)
            .navigationTitle("Smart Assistant")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        viewModel.newConversation()
                    } label: {
                        Image(systemName: "plus.message")
                    }
                }
            }
        }
    }
}

// MARK: - Chat Bubble

private struct ChatBubble: View {
    let message: ChatMessage

    var body: some View {
        HStack {
            if message.isUser { Spacer(minLength: 60) }

            Text(message.text)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(message.isUser ? AppTheme.accent : Color(.systemGray5))
                .foregroundStyle(message.isUser ? .white : .primary)
                .clipShape(RoundedRectangle(cornerRadius: 16))

            if !message.isUser { Spacer(minLength: 60) }
        }
        .padding(.horizontal, 16)
    }
}

#Preview {
    AssistantView()
}
