import Foundation

// MARK: - KioskPrefs — UserDefaults config (mirrors Android KioskPrefs)

final class KioskPrefs {
    static let shared = KioskPrefs()

    private let defaults = UserDefaults.standard

    private enum Keys {
        static let startUrl = "startUrl"
        static let httpPort = "httpPort"
        static let httpPassword = "httpPassword"
        static let settingsPassword = "settingsPassword"
        static let screenTimeout = "screenTimeout"
        static let autoRestartHours = "autoRestartHours"
    }

    var startUrl: String {
        get { defaults.string(forKey: Keys.startUrl) ?? "https://alpacaplayhouse.com/kioskhall/" }
        set { defaults.set(newValue, forKey: Keys.startUrl) }
    }

    var httpPort: UInt16 {
        get {
            let val = defaults.integer(forKey: Keys.httpPort)
            return val > 0 ? UInt16(val) : 2323
        }
        set { defaults.set(Int(newValue), forKey: Keys.httpPort) }
    }

    var httpPassword: String {
        get { defaults.string(forKey: Keys.httpPassword) ?? "alpaca2323" }
        set { defaults.set(newValue, forKey: Keys.httpPassword) }
    }

    var settingsPassword: String {
        get { defaults.string(forKey: Keys.settingsPassword) ?? "1234" }
        set { defaults.set(newValue, forKey: Keys.settingsPassword) }
    }

    /// Minutes before screen dims. 0 = never.
    var screenTimeout: Int {
        get { defaults.integer(forKey: Keys.screenTimeout) }
        set { defaults.set(newValue, forKey: Keys.screenTimeout) }
    }

    /// Hours between automatic WebView reloads. 0 = disabled.
    var autoRestartHours: Int {
        get { defaults.integer(forKey: Keys.autoRestartHours) }
        set { defaults.set(newValue, forKey: Keys.autoRestartHours) }
    }
}
