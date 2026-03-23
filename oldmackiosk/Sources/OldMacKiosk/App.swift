import AppKit

// MARK: - App Entry Point

@main
struct OldMacKioskMain {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
    }
}

class AppDelegate: NSObject, NSApplicationDelegate {
    var kioskWindow: KioskWindow!
    var webViewController: WebViewController!
    var httpServer: HttpApiServer!
    var lockdownManager: LockdownManager!
    var screenManager: ScreenManager!
    var settingsPanel: SettingsPanel?

    func applicationDidFinishLaunching(_ notification: Notification) {
        print("[OldMacKiosk] Starting up...")

        // Initialize managers
        screenManager = ScreenManager()
        screenManager.preventSleep()

        // Create the fullscreen kiosk window
        kioskWindow = KioskWindow()
        webViewController = WebViewController()
        kioskWindow.contentViewController = webViewController
        kioskWindow.makeKeyAndOrderFront(nil)

        // Set up lockdown
        lockdownManager = LockdownManager(window: kioskWindow, onTripleTap: { [weak self] in
            self?.showSettings()
        })
        lockdownManager.engage()

        // Start HTTP API server
        httpServer = HttpApiServer(
            webViewController: webViewController,
            screenManager: screenManager,
            onShowSettings: { [weak self] in
                self?.showSettings()
            }
        )
        httpServer.start()

        // Load the kiosk page
        let startUrl = KioskPrefs.shared.startUrl
        webViewController.loadURL(startUrl)

        print("[OldMacKiosk] Ready — serving on port \(KioskPrefs.shared.httpPort)")
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    func showSettings() {
        if settingsPanel == nil {
            settingsPanel = SettingsPanel(
                onSave: { [weak self] in
                    self?.webViewController.loadURL(KioskPrefs.shared.startUrl)
                    self?.settingsPanel?.close()
                    self?.settingsPanel = nil
                },
                onClose: { [weak self] in
                    self?.settingsPanel?.close()
                    self?.settingsPanel = nil
                },
                onQuit: {
                    NSApplication.shared.terminate(nil)
                }
            )
        }
        settingsPanel?.show(in: kioskWindow)
    }
}
