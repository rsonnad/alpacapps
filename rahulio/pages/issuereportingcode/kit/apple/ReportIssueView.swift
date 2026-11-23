// Issue reporting kit: SwiftUI form ("Report a bug" / "Request a feature") for iOS 16+ and macOS 13+. MIT licence.
//
// Present it as a sheet, capturing the screen first so the form isn't in the picture:
//   @State private var report: ReportRequest?
//   Button("Report a bug") { report = ReportRequest(kind: .bug, screen: "Settings") }
//   .sheet(item: $report) { ReportIssueView(request: $0) }
import PhotosUI
import SwiftUI

public struct ReportRequest: Identifiable {
    public let id = UUID()
    public let kind: IssueKind
    public let screen: String?
    let lastScreen: Data?
    @MainActor public init(kind: IssueKind, screen: String?) {
        self.kind = kind
        self.screen = screen
        lastScreen = Screenshots.lastScreen().flatMap(Screenshots.jpeg)
    }
}

public struct ReportIssueView: View {
    let request: ReportRequest
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var store = IssueStore.shared
    @State private var kind: IssueKind
    @AppStorage("issues.bug.draft") private var bugDraft = ""
    @AppStorage("issues.feature.draft") private var featureDraft = ""
    @State private var includeLast = true
    @State private var includeLog = true
    @State private var picked: [Data] = []
    #if os(iOS)
    @State private var pickerItems: [PhotosPickerItem] = []
    #else
    @State private var importing = false
    #endif
    @State private var error: String?
    @State private var saved: Issue?
    @State private var askKeep = false
    @State private var showLog = false
    private let log = RecentLog.shared.snapshot()

    public init(request: ReportRequest) {
        self.request = request
        _kind = State(initialValue: request.kind)
    }

    private var text: Binding<String> { kind == .bug ? $bugDraft : $featureDraft } // each kind keeps its own draft
    private var maxPicked: Int { IssueConfig.maxImages - (includeLast && request.lastScreen != nil ? 1 : 0) }

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if let error {
                        Text(error).padding(12).frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.red.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
                    }
                    Text(kind == .bug ? "Describe what went wrong." : "Describe what you’d like.").foregroundStyle(.secondary)
                    Picker("Type", selection: $kind) {
                        Text("Bug").tag(IssueKind.bug)
                        Text("Feature").tag(IssueKind.feature)
                    }
                    .pickerStyle(.segmented)

                    panel {
                        Text(kind == .bug ? "What happened?" : "What would you like to see?").font(.subheadline.weight(.semibold))
                        ZStack(alignment: .topLeading) {
                            TextEditor(text: text).frame(minHeight: 100)
                            if text.wrappedValue.isEmpty {
                                Text(kind == .bug ? "What you expected, what you saw…" : "What would you like the app to do?")
                                    .foregroundStyle(.tertiary).padding(.top, 8).padding(.leading, 5).allowsHitTesting(false)
                            }
                        }
                    }

                    panel {
                        if let last = request.lastScreen {
                            Toggle(isOn: $includeLast) {
                                HStack(spacing: 12) {
                                    thumbnail(last).frame(width: 40, height: 60)
                                    VStack(alignment: .leading) {
                                        Text("Include last screen")
                                        Text(request.screen.map { "\($0), as you left it" } ?? "The screen you were on").font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                        if !picked.isEmpty {
                            HStack(spacing: 8) {
                                ForEach(Array(picked.enumerated()), id: \.offset) { i, data in
                                    thumbnail(data).frame(width: 48, height: 72).overlay(alignment: .topTrailing) {
                                        Button { picked.remove(at: i) } label: { Image(systemName: "xmark.circle.fill") }
                                            .buttonStyle(.plain).accessibilityLabel("Remove screenshot \(i + 1)")
                                    }
                                }
                            }
                        }
                        addScreenshotButton
                        Toggle(isOn: $includeLog) {
                            VStack(alignment: .leading) {
                                Text("Include recent log")
                                HStack(spacing: 4) {
                                    Text("\(log.count) log \(log.count == 1 ? "entry" : "entries") ·").font(.caption)
                                    Button("Preview") { showLog = true }.font(.caption).buttonStyle(.borderless)
                                }
                            }
                        }
                    }
                    Text("App version, device info and the screen you were on are included automatically.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                .padding(16)
            }
            .navigationTitle(kind.title)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: cancel) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Submit", action: submit).buttonStyle(.borderedProminent)
                        .disabled(text.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .confirmationDialog("Keep this draft?", isPresented: $askKeep) {
            Button("Keep") { dismiss() }
            Button("Discard", role: .destructive) { text.wrappedValue = ""; dismiss() }
        }
        .sheet(isPresented: $showLog) {
            NavigationStack {
                List(Array(log.enumerated()), id: \.offset) { _, e in Text("\(e.level) \(e.tag): \(e.msg)").font(.caption.monospaced()) }
                    .overlay { if log.isEmpty { Text("No log entries yet.").foregroundStyle(.secondary) } }
                    .navigationTitle("Recent log")
                    .toolbar { Button("Close") { showLog = false } }
            }
        }
        .alert("Report saved", isPresented: Binding(get: { saved != nil }, set: { if !$0 { dismiss() } })) {
            Button("Done") { dismiss() }
        } message: {
            if let id = store.issues.first(where: { $0.id == saved?.id })?.remoteId {
                Text("Thanks. It’s report #\(id), and the team has it.")
            } else {
                Text("Thanks. It’s saved on your device and will be sent to the team when you’re online.")
            }
        }
        .interactiveDismissDisabled(!text.wrappedValue.isEmpty)
    }

    @ViewBuilder private var addScreenshotButton: some View {
        #if os(iOS)
        PhotosPicker(selection: $pickerItems, maxSelectionCount: max(maxPicked - picked.count, 1), matching: .images) {
            Text(picked.isEmpty ? "Add screenshot" : "Add another")
        }
        .disabled(picked.count >= maxPicked)
        .onChange(of: pickerItems) { items in
            Task {
                for item in items {
                    if let data = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: data), let jpeg = Screenshots.jpeg(img), picked.count < maxPicked {
                        picked.append(jpeg)
                    } else { error = "Couldn’t add one of those pictures. Please try again." }
                }
                pickerItems = []
            }
        }
        #else
        Button(picked.isEmpty ? "Add screenshot" : "Add another") { importing = true }
            .disabled(picked.count >= maxPicked)
            .fileImporter(isPresented: $importing, allowedContentTypes: [.image], allowsMultipleSelection: true) { result in
                for url in (try? result.get()) ?? [] {
                    let ok = url.startAccessingSecurityScopedResource(); defer { if ok { url.stopAccessingSecurityScopedResource() } }
                    if let img = NSImage(contentsOf: url), let jpeg = Screenshots.jpeg(img), picked.count < maxPicked { picked.append(jpeg) }
                    else { error = "Couldn’t add one of those pictures. Please try again." }
                }
            }
        #endif
    }

    private func panel<C: View>(@ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 12, content: content)
            .padding(16).frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.secondary.opacity(0.25), lineWidth: 1))
    }

    @ViewBuilder private func thumbnail(_ data: Data) -> some View {
        #if os(iOS)
        if let img = UIImage(data: data) { Image(uiImage: img).resizable().scaledToFill().clipShape(RoundedRectangle(cornerRadius: 4)) }
        #else
        if let img = NSImage(data: data) { Image(nsImage: img).resizable().scaledToFill().clipShape(RoundedRectangle(cornerRadius: 4)) }
        #endif
    }

    private func cancel() {
        if text.wrappedValue.isEmpty { dismiss() } else { askKeep = true }
    }

    private func submit() {
        do {
            var images: [Data] = []
            if includeLast, let last = request.lastScreen { images.append(last) }
            images += picked
            saved = try store.create(kind: kind, description: text.wrappedValue, images: images, includeLog: includeLog, screen: request.screen)
            text.wrappedValue = ""
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? "Couldn’t save the report. Please try again."
        }
    }
}
