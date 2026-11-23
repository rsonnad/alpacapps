// Issue reporting kit: iOS / macOS core (storage, identity, upload, status pull). SwiftUI-agnostic.
// Derived from Bridgit's in-app "Report a bug / Request a feature" flow. MIT licence.
// iOS 16+ / macOS 13+. No dependencies.
import Foundation
import Security
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

public enum IssueConfig {
    public static var baseURL = URL(string: "https://issue-reports.YOUR-SUBDOMAIN.workers.dev")!
    public static let maxImages = 5
    public static let maxImageBytes = 1_000_000
    public static let maxImageEdge: CGFloat = 1280
    public static let maxDescription = 10_000
    public static let perKindPerHour = 10
}

public enum IssueKind: String, Codable, CaseIterable, Identifiable {
    case bug, feature
    public var id: String { rawValue }
    public var title: String { self == .bug ? "Report a bug" : "Request a feature" }
}

public struct Issue: Codable, Identifiable, Equatable {
    public var id: Int64                 // local id; sent as client_issue_id
    public var kind: IssueKind
    public var description: String
    public var createdAt: Int64          // epoch ms
    public var context: [String: String]
    public var log: [LogEntry]
    public var imageCount: Int
    public var remoteId: Int64?          // the server's id once sent
    public var uploadError: String?
    public var refused = false           // the server said no (4xx): retrying won't help
    public var status = "new"            // the team's status
    public var teamNote: String?
}

public struct LogEntry: Codable, Equatable {
    public var at: Int64
    public var level: String
    public var tag: String
    public var msg: String
}

public enum IssueError: LocalizedError {
    case rateLimited, http(Int, String)
    public var errorDescription: String? {
        switch self {
        case .rateLimited: return "That’s 10 reports this hour. Try again later."
        case let .http(code, error): return "HTTP \(code) \(error)"
        }
    }
}

/// A small ring buffer of recent app events. Call `RecentLog.shared.add(...)` where you already log; redact first.
public final class RecentLog {
    public static let shared = RecentLog()
    private var entries: [LogEntry] = []
    private let queue = DispatchQueue(label: "recent-log")
    public func add(_ level: String, _ tag: String, _ msg: String) {
        queue.sync {
            entries.append(LogEntry(at: Int64(Date().timeIntervalSince1970 * 1000), level: level, tag: tag, msg: String(msg.prefix(500))))
            if entries.count > 50 { entries.removeFirst(entries.count - 50) }
        }
    }
    public func snapshot() -> [LogEntry] { queue.sync { entries } }
}

/// One folder per issue under Application Support/issues/<id>/: issue.json plus img-1.jpg … img-5.jpg.
@MainActor
public final class IssueStore: ObservableObject {
    public static let shared = IssueStore()
    @Published public private(set) var issues: [Issue] = []
    private let root: URL

    init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        root = base.appendingPathComponent("issues", isDirectory: true)
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        reload()
    }

    public func reload() {
        let dirs = (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)) ?? []
        issues = dirs.compactMap { dir in
            (try? Data(contentsOf: dir.appendingPathComponent("issue.json"))).flatMap { try? JSONDecoder().decode(Issue.self, from: $0) }
        }.sorted { $0.createdAt > $1.createdAt }
    }

    public func images(_ id: Int64) -> [Data] {
        (1...IssueConfig.maxImages).compactMap { try? Data(contentsOf: root.appendingPathComponent("\(id)/img-\($0).jpg")) }
    }

    /// Saves the issue on the device, then tries to send it. Throws `IssueError.rateLimited`.
    @discardableResult
    public func create(kind: IssueKind, description: String, images: [Data], includeLog: Bool, screen: String?) throws -> Issue {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        if issues.filter({ $0.kind == kind && $0.createdAt > now - 3_600_000 }).count >= IssueConfig.perKindPerHour { throw IssueError.rateLimited }
        let id = Int64.random(in: 1...(1 << 53 - 1)) // unique per install without a counter; safe as a JSON number
        let dir = root.appendingPathComponent("\(id)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        for (i, data) in images.prefix(IssueConfig.maxImages).enumerated() { try data.write(to: dir.appendingPathComponent("img-\(i + 1).jpg")) }
        let issue = Issue(id: id, kind: kind, description: String(description.trimmingCharacters(in: .whitespacesAndNewlines).prefix(IssueConfig.maxDescription)),
                          createdAt: now, context: IssueContext.build(screen: screen), log: includeLog ? RecentLog.shared.snapshot() : [],
                          imageCount: min(images.count, IssueConfig.maxImages))
        try save(issue)
        Task { await sendPending() }
        return issue
    }

    func save(_ issue: Issue) throws {
        let url = root.appendingPathComponent("\(issue.id)/issue.json")
        try JSONEncoder().encode(issue).write(to: url, options: .atomic)
        if let i = issues.firstIndex(where: { $0.id == issue.id }) { issues[i] = issue } else { issues.insert(issue, at: 0) }
    }

    /// Sends everything not yet sent. Call on launch, on Submit and when the app comes to the foreground.
    public func sendPending() async {
        for issue in issues where issue.remoteId == nil && !issue.refused {
            var updated = issue
            do {
                updated.remoteId = try await IssueAPI.send(issue, images: images(issue.id))
                updated.uploadError = nil
            } catch let IssueError.http(code, error) where code != 429 && code < 500 {
                updated.uploadError = "HTTP \(code) \(error)"
                updated.refused = true
            } catch {
                updated.uploadError = error.localizedDescription // offline or 5xx: tried again next time
            }
            try? save(updated)
        }
    }

    /// Pulls what the team changed (status, note) since the saved cursor.
    public func pullUpdates() async {
        let d = UserDefaults.standard
        var more = true
        while more {
            guard let page = try? await IssueAPI.updates(since: Int64(d.integer(forKey: "issues.cursor")),
                                                         sinceId: d.object(forKey: "issues.cursorId") as? Int64) else { return }
            for u in page.updates {
                if var local = issues.first(where: { $0.remoteId == u.id }) {
                    local.status = u.status; local.teamNote = u.team_note
                    try? save(local)
                }
            }
            d.set(page.cursor, forKey: "issues.cursor")
            if let c = page.cursor_id { d.set(c, forKey: "issues.cursorId") }
            more = page.more
        }
    }
}

/// What goes with every report automatically. Never put secrets or personal data here.
public enum IssueContext {
    public static func build(screen: String?) -> [String: String] {
        let info = Bundle.main.infoDictionary ?? [:]
        var c: [String: String] = [
            "app_version": info["CFBundleShortVersionString"] as? String ?? "?",
            "app_build": info["CFBundleVersion"] as? String ?? "?",
            "device_model": deviceModel(),
            "os_version": ProcessInfo.processInfo.operatingSystemVersionString,
            "locale": Locale.current.identifier,
        ]
        #if DEBUG
        c["build_type"] = "debug"
        #else
        c["build_type"] = "release"
        #endif
        #if os(iOS)
        c["os_name"] = "ios"
        #else
        c["os_name"] = "macos"
        #endif
        if let screen { c["screen"] = screen }
        return c
    }

    static func deviceModel() -> String {
        var size = 0
        let key = "hw.machine"
        sysctlbyname(key, nil, &size, nil, 0)
        var buf = [CChar](repeating: 0, count: max(size, 1))
        sysctlbyname(key, &buf, &size, nil, 0)
        return String(cString: buf)
    }
}

/// The install's identity: a UUID and a random key, made once and kept in the Keychain.
public enum InstallIdentity {
    private static let service = "issue-reports.install"

    static func headers() -> [String: String] {
        let (id, key) = load() ?? create()
        return ["X-Install-Id": id, "Authorization": "Bearer \(key)"]
    }

    private static func create() -> (String, String) {
        let id = UUID().uuidString.lowercased()
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        let key = Data(bytes).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        let value = Data("\(id) \(key)".utf8)
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "install",
                                kSecValueData as String: value, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        SecItemDelete(q as CFDictionary)
        SecItemAdd(q as CFDictionary, nil)
        return (id, key)
    }

    private static func load() -> (String, String)? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "install",
                                kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data,
              let parts = String(data: data, encoding: .utf8)?.split(separator: " "), parts.count == 2 else { return nil }
        return (String(parts[0]), String(parts[1]))
    }
}

/// The two app-side calls.
public enum IssueAPI {
    struct Created: Decodable { let id: Int64 }
    struct ErrorBody: Decodable { let error: String }
    public struct Update: Decodable { public let id: Int64; public let status: String; public let team_note: String? }
    public struct UpdatesPage: Decodable { public let updates: [Update]; public let cursor: Int64; public let cursor_id: Int64?; public let more: Bool }

    static func send(_ issue: Issue, images: [Data]) async throws -> Int64 {
        let body: [String: Any] = [
            "client_issue_id": issue.id,
            "kind": issue.kind.rawValue,
            "description": issue.description,
            "created_at": issue.createdAt,
            "context": issue.context,
            "log": issue.log.map { ["at": $0.at, "level": $0.level, "tag": $0.tag, "msg": $0.msg] },
            "images": images.map { ["mime": "image/jpeg", "data_base64": $0.base64EncodedString()] },
        ]
        let data = try await request("POST", "v1/issues", body: try JSONSerialization.data(withJSONObject: body))
        return try JSONDecoder().decode(Created.self, from: data).id
    }

    static func updates(since: Int64, sinceId: Int64?) async throws -> UpdatesPage {
        var path = "v1/issues/updates?since=\(since)"
        if let sinceId { path += "&since_id=\(sinceId)" }
        return try JSONDecoder().decode(UpdatesPage.self, from: try await request("GET", path, body: nil))
    }

    private static func request(_ method: String, _ path: String, body: Data?) async throws -> Data {
        var req = URLRequest(url: URL(string: path, relativeTo: IssueConfig.baseURL)!)
        req.httpMethod = method
        req.timeoutInterval = 90
        InstallIdentity.headers().forEach { req.setValue($1, forHTTPHeaderField: $0) }
        if let body { req.httpBody = body; req.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let (data, response) = try await URLSession.shared.data(for: req)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200...299).contains(code) else { throw IssueError.http(code, (try? JSONDecoder().decode(ErrorBody.self, from: data))?.error ?? "") }
        return data
    }
}

/// Screenshots: grab the key window before the form opens, and shrink any picture to <= 1280 px / 1 MB JPEG.
public enum Screenshots {
    #if canImport(UIKit)
    @MainActor public static func lastScreen() -> UIImage? {
        guard let window = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).flatMap(\.windows).first(where: \.isKeyWindow) else { return nil }
        return UIGraphicsImageRenderer(bounds: window.bounds).image { _ in window.drawHierarchy(in: window.bounds, afterScreenUpdates: false) }
    }

    public static func jpeg(_ image: UIImage) -> Data? {
        let scale = min(1, IssueConfig.maxImageEdge / max(image.size.width, image.size.height))
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let format = UIGraphicsImageRendererFormat.default(); format.scale = 1
        let small = UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        var q: CGFloat = 0.75
        while q > 0.2 {
            if let d = small.jpegData(compressionQuality: q), d.count <= IssueConfig.maxImageBytes { return d }
            q -= 0.15
        }
        return nil
    }
    #elseif canImport(AppKit)
    @MainActor public static func lastScreen() -> NSImage? {
        guard let view = NSApp.keyWindow?.contentView, let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return nil }
        view.cacheDisplay(in: view.bounds, to: rep)
        let img = NSImage(size: view.bounds.size); img.addRepresentation(rep)
        return img
    }

    public static func jpeg(_ image: NSImage) -> Data? {
        let scale = min(1, IssueConfig.maxImageEdge / max(image.size.width, image.size.height))
        let size = NSSize(width: image.size.width * scale, height: image.size.height * scale)
        guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size.width), pixelsHigh: Int(size.height), bitsPerSample: 8,
                                         samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return nil }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        image.draw(in: NSRect(origin: .zero, size: size))
        NSGraphicsContext.restoreGraphicsState()
        var q = 0.75
        while q > 0.2 {
            if let d = rep.representation(using: .jpeg, properties: [.compressionFactor: q]), d.count <= IssueConfig.maxImageBytes { return d }
            q -= 0.15
        }
        return nil
    }
    #endif
}
