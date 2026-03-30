import SwiftUI

// MARK: - SubtitleSegment

struct SubtitleSegment: Identifiable, Equatable {
    let id: String
    let text: String
    let lang: String
    let sourceLang: String
    let sourceText: String
    let timestamp: Int
    let isPartial: Bool
}

// MARK: - SubtitleService

@Observable
final class SubtitleService {
    var segments: [SubtitleSegment] = []
    var connectionStatus: String = "checking" // checking, connected, connecting, disconnected, unavailable
    var serverActive = false
    var selectedLang: String

    private var wsTask: URLSessionWebSocketTask?
    private var reconnectDelay: TimeInterval = 1
    private let maxSegments = 50
    private let wsHost = "alpuca.local"
    private let wsPort = 8910

    init() {
        let phoneLang = Locale.current.language.languageCode?.identifier ?? "en"
        let supported = ["en", "pl", "es", "fr", "de", "pt", "it", "hi", "ar"]
        selectedLang = supported.contains(phoneLang) ? phoneLang : "en"
    }

    func checkServer() async {
        guard let url = URL(string: "http://\(wsHost):\(wsPort)/subtitles/status") else {
            serverActive = false
            connectionStatus = "unavailable"
            return
        }
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let active = json["active"] as? Bool {
                serverActive = active
                if !active { connectionStatus = "unavailable" }
            }
        } catch {
            serverActive = false
            connectionStatus = "unavailable"
        }
    }

    func connect() {
        disconnect()
        guard serverActive else { return }

        connectionStatus = "connecting"
        guard let url = URL(string: "ws://\(wsHost):\(wsPort)/subtitles?lang=\(selectedLang)") else { return }

        let session = URLSession(configuration: .default)
        wsTask = session.webSocketTask(with: url)
        wsTask?.resume()

        connectionStatus = "connected"
        reconnectDelay = 1
        receiveMessages()
    }

    func disconnect() {
        wsTask?.cancel(with: .normalClosure, reason: nil)
        wsTask = nil
    }

    func changeLang(_ lang: String) {
        selectedLang = lang
        segments = []
        connect()
    }

    private func receiveMessages() {
        wsTask?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let message):
                if case .string(let text) = message {
                    self.handleMessage(text)
                }
                self.receiveMessages()
            case .failure:
                DispatchQueue.main.async {
                    self.connectionStatus = "disconnected"
                    self.scheduleReconnect()
                }
            }
        }
    }

    private func handleMessage(_ text: String) {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              json["type"] as? String == "subtitle" else { return }

        let seg = SubtitleSegment(
            id: json["id"] as? String ?? "",
            text: json["text"] as? String ?? "",
            lang: json["lang"] as? String ?? "",
            sourceLang: json["source_lang"] as? String ?? "",
            sourceText: json["source_text"] as? String ?? "",
            timestamp: json["timestamp"] as? Int ?? 0,
            isPartial: json["is_partial"] as? Bool ?? false
        )

        DispatchQueue.main.async {
            if seg.isPartial {
                if let idx = self.segments.firstIndex(where: { $0.id == seg.id && $0.isPartial }) {
                    self.segments[idx] = seg
                } else {
                    self.segments.append(seg)
                }
            } else {
                self.segments.removeAll { $0.id == seg.id && $0.isPartial }
                self.segments.append(seg)
            }
            while self.segments.count > self.maxSegments {
                self.segments.removeFirst()
            }
        }
    }

    private func scheduleReconnect() {
        DispatchQueue.main.asyncAfter(deadline: .now() + reconnectDelay) { [weak self] in
            guard let self, self.serverActive else { return }
            self.reconnectDelay = min(30, self.reconnectDelay * 2)
            self.connect()
        }
    }
}

// MARK: - SubtitleView

struct SubtitleView: View {
    @State private var service = SubtitleService()
    @State private var fontSize: CGFloat = 20

    private let langs: [(String, String)] = [
        ("en", "English"),
        ("pl", "Polski"),
        ("es", "Espanol"),
        ("fr", "Francais"),
        ("de", "Deutsch"),
        ("pt", "Portugues"),
        ("it", "Italiano"),
        ("hi", "Hindi"),
        ("ar", "Arabic"),
    ]

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Status + controls
                HStack(spacing: 8) {
                    // Status dot
                    Circle()
                        .fill(statusColor)
                        .frame(width: 8, height: 8)

                    Text(statusText)
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    Spacer()

                    // Font size
                    Button { fontSize = max(12, fontSize - 2) } label: {
                        Image(systemName: "textformat.size.smaller")
                            .foregroundStyle(AppTheme.accent)
                    }
                    Button { fontSize = min(40, fontSize + 2) } label: {
                        Image(systemName: "textformat.size.larger")
                            .foregroundStyle(AppTheme.accent)
                    }
                }
                .padding(.horizontal)
                .padding(.vertical, 8)

                // Language picker
                HStack {
                    Image(systemName: "globe")
                        .foregroundStyle(Color(hex: 0x5CB85C))
                    Picker("Language", selection: $service.selectedLang) {
                        ForEach(langs, id: \.0) { code, name in
                            Text(name).tag(code)
                        }
                    }
                    .pickerStyle(.menu)
                    .tint(Color(hex: 0x5CB85C))
                }
                .padding(.horizontal)
                .padding(.bottom, 8)

                Divider()

                // Content
                if !service.serverActive {
                    Spacer()
                    VStack(spacing: 12) {
                        Image(systemName: "captions.bubble")
                            .font(.system(size: 44))
                            .foregroundStyle(.tertiary)
                        Text("Subtitles are not active right now")
                            .foregroundStyle(.secondary)
                        Text("They'll appear here during events")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                    Spacer()
                } else if service.segments.isEmpty {
                    Spacer()
                    Text("Waiting for subtitles...")
                        .foregroundStyle(.secondary)
                    Spacer()
                } else {
                    ScrollViewReader { proxy in
                        ScrollView {
                            LazyVStack(alignment: .leading, spacing: 10) {
                                ForEach(service.segments) { seg in
                                    VStack(alignment: .leading, spacing: 4) {
                                        if seg.lang != "en" && !seg.sourceText.isEmpty {
                                            // Original (dim, smaller) on top
                                            Text(seg.sourceText)
                                                .font(.system(size: fontSize * 0.6))
                                                .foregroundStyle(Color(hex: 0x8A7E82).opacity(0.7))
                                                .italic(seg.isPartial)
                                        }
                                        // Preferred language (bright, full size) below
                                        Text(seg.text)
                                            .font(.system(size: fontSize))
                                            .foregroundStyle(seg.isPartial ? .secondary : .primary)
                                            .italic(seg.isPartial)
                                    }
                                    .id(seg.id)
                                }
                            }
                            .padding()
                        }
                        .onChange(of: service.segments.count) {
                            if let last = service.segments.last {
                                withAnimation {
                                    proxy.scrollTo(last.id, anchor: .bottom)
                                }
                            }
                        }
                    }
                }
            }
            .background(Color(hex: 0x110E10))
            .navigationTitle("Subtitles")
            .task {
                await service.checkServer()
                if service.serverActive {
                    service.connect()
                }
            }
            .onChange(of: service.selectedLang) {
                service.changeLang(service.selectedLang)
            }
            .onDisappear {
                service.disconnect()
            }
        }
    }

    private var statusColor: Color {
        switch service.connectionStatus {
        case "connected": Color(hex: 0x5CB85C)
        case "connecting": Color(hex: 0xE99C48)
        default: Color(hex: 0xD9534F)
        }
    }

    private var statusText: String {
        switch service.connectionStatus {
        case "connected": "Connected (\(service.selectedLang))"
        case "connecting": "Connecting..."
        case "unavailable": "Server not available"
        default: "Disconnected"
        }
    }
}

// Color helper
private extension Color {
    init(hex: UInt, alpha: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: alpha
        )
    }
}

#Preview {
    SubtitleView()
}
