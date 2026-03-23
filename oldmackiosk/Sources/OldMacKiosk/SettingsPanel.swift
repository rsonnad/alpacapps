import AppKit

// MARK: - SettingsPanel — Hidden settings UI (triple-tap bottom-right to reveal)

class SettingsPanel {
    private var panel: NSPanel?
    private var passwordField: NSSecureTextField?
    private var authenticated = false

    private let onSave: () -> Void
    private let onClose: () -> Void
    private let onQuit: () -> Void

    init(onSave: @escaping () -> Void, onClose: @escaping () -> Void, onQuit: @escaping () -> Void) {
        self.onSave = onSave
        self.onClose = onClose
        self.onQuit = onQuit
    }

    func show(in window: NSWindow) {
        if !authenticated {
            showPasswordPrompt(in: window)
        } else {
            showSettingsUI(in: window)
        }
    }

    func close() {
        panel?.close()
        panel = nil
        authenticated = false
    }

    // MARK: - Password Prompt

    private func showPasswordPrompt(in window: NSWindow) {
        let panelWidth: CGFloat = 360
        let panelHeight: CGFloat = 180
        let screenFrame = window.frame
        let x = screenFrame.midX - panelWidth / 2
        let y = screenFrame.midY - panelHeight / 2

        let p = NSPanel(
            contentRect: NSRect(x: x, y: y, width: panelWidth, height: panelHeight),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        p.title = "OldMacKiosk Settings"
        p.level = .floating + 1
        p.isFloatingPanel = true
        p.becomesKeyOnlyIfNeeded = false

        let contentView = NSView(frame: NSRect(x: 0, y: 0, width: panelWidth, height: panelHeight))

        let label = NSTextField(labelWithString: "Enter settings password:")
        label.frame = NSRect(x: 20, y: 120, width: 320, height: 24)
        label.font = NSFont.systemFont(ofSize: 14)
        contentView.addSubview(label)

        let pwField = NSSecureTextField(frame: NSRect(x: 20, y: 85, width: 320, height: 28))
        pwField.placeholderString = "Password"
        pwField.font = NSFont.systemFont(ofSize: 14)
        contentView.addSubview(pwField)
        self.passwordField = pwField

        let unlockBtn = NSButton(frame: NSRect(x: 230, y: 40, width: 110, height: 32))
        unlockBtn.title = "Unlock"
        unlockBtn.bezelStyle = .rounded
        unlockBtn.target = self
        unlockBtn.action = #selector(checkPassword)
        contentView.addSubview(unlockBtn)

        let cancelBtn = NSButton(frame: NSRect(x: 120, y: 40, width: 100, height: 32))
        cancelBtn.title = "Cancel"
        cancelBtn.bezelStyle = .rounded
        cancelBtn.target = self
        cancelBtn.action = #selector(cancelTapped)
        contentView.addSubview(cancelBtn)

        p.contentView = contentView
        p.makeKeyAndOrderFront(nil)
        p.makeFirstResponder(pwField)
        self.panel = p
    }

    @objc private func checkPassword() {
        let entered = passwordField?.stringValue ?? ""
        if entered == KioskPrefs.shared.settingsPassword {
            authenticated = true
            panel?.close()
            panel = nil
            // Re-show with settings UI
            if let window = NSApplication.shared.mainWindow {
                showSettingsUI(in: window)
            }
        } else {
            passwordField?.stringValue = ""
            passwordField?.placeholderString = "Wrong password"
            NSSound.beep()
        }
    }

    @objc private func cancelTapped() {
        onClose()
    }

    // MARK: - Settings UI

    private func showSettingsUI(in window: NSWindow) {
        let panelWidth: CGFloat = 460
        let panelHeight: CGFloat = 420
        let screenFrame = window.frame
        let x = screenFrame.midX - panelWidth / 2
        let y = screenFrame.midY - panelHeight / 2

        let p = NSPanel(
            contentRect: NSRect(x: x, y: y, width: panelWidth, height: panelHeight),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        p.title = "OldMacKiosk Settings"
        p.level = .floating + 1
        p.isFloatingPanel = true

        let contentView = NSView(frame: NSRect(x: 0, y: 0, width: panelWidth, height: panelHeight))
        var yPos: CGFloat = panelHeight - 50

        // Helper to add a labeled field
        func addField(_ labelText: String, value: String, tag: Int) -> NSTextField {
            let label = NSTextField(labelWithString: labelText)
            label.frame = NSRect(x: 20, y: yPos, width: 140, height: 22)
            label.font = NSFont.systemFont(ofSize: 13)
            contentView.addSubview(label)

            let field = NSTextField(frame: NSRect(x: 170, y: yPos, width: 270, height: 24))
            field.stringValue = value
            field.font = NSFont.systemFont(ofSize: 13)
            field.tag = tag
            contentView.addSubview(field)

            yPos -= 40
            return field
        }

        let urlField = addField("Start URL:", value: KioskPrefs.shared.startUrl, tag: 1)
        let portField = addField("HTTP Port:", value: "\(KioskPrefs.shared.httpPort)", tag: 2)
        let pwField = addField("API Password:", value: KioskPrefs.shared.httpPassword, tag: 3)
        let settingsPwField = addField("Settings Password:", value: KioskPrefs.shared.settingsPassword, tag: 4)
        let timeoutField = addField("Screen Timeout (min):", value: "\(KioskPrefs.shared.screenTimeout)", tag: 5)
        let restartField = addField("Auto-restart (hours):", value: "\(KioskPrefs.shared.autoRestartHours)", tag: 6)

        // Device info
        yPos -= 10
        let info = ScreenManager.deviceInfoDict()
        let infoText = "📍 \(info["hostname"] ?? "") | macOS \(info["osVersion"] ?? "") | 🔋 \(info["batteryPercent"] ?? "?")% | 📶 \(info["wifiSSID"] ?? "")"
        let infoLabel = NSTextField(labelWithString: infoText)
        infoLabel.frame = NSRect(x: 20, y: yPos, width: 420, height: 20)
        infoLabel.font = NSFont.systemFont(ofSize: 11)
        infoLabel.textColor = .secondaryLabelColor
        contentView.addSubview(infoLabel)

        yPos -= 50

        // Buttons
        let saveBtn = NSButton(frame: NSRect(x: 310, y: yPos, width: 120, height: 32))
        saveBtn.title = "Save & Reload"
        saveBtn.bezelStyle = .rounded
        saveBtn.target = self
        saveBtn.action = #selector(saveTapped)
        contentView.addSubview(saveBtn)

        let closeBtn = NSButton(frame: NSRect(x: 200, y: yPos, width: 100, height: 32))
        closeBtn.title = "Close"
        closeBtn.bezelStyle = .rounded
        closeBtn.target = self
        closeBtn.action = #selector(cancelTapped)
        contentView.addSubview(closeBtn)

        let quitBtn = NSButton(frame: NSRect(x: 20, y: yPos, width: 100, height: 32))
        quitBtn.title = "Quit App"
        quitBtn.bezelStyle = .rounded
        quitBtn.contentTintColor = .systemRed
        quitBtn.target = self
        quitBtn.action = #selector(quitTapped)
        contentView.addSubview(quitBtn)

        // Store field references via tags
        p.contentView = contentView
        p.makeKeyAndOrderFront(nil)
        self.panel = p

        // Store fields in panel for retrieval
        urlField.identifier = NSUserInterfaceItemIdentifier("url")
        portField.identifier = NSUserInterfaceItemIdentifier("port")
        pwField.identifier = NSUserInterfaceItemIdentifier("pw")
        settingsPwField.identifier = NSUserInterfaceItemIdentifier("settingsPw")
        timeoutField.identifier = NSUserInterfaceItemIdentifier("timeout")
        restartField.identifier = NSUserInterfaceItemIdentifier("restart")
    }

    @objc private func saveTapped() {
        guard let contentView = panel?.contentView else { return }

        // Find fields by identifier
        func fieldValue(_ id: String) -> String {
            return (contentView.subviews.compactMap { $0 as? NSTextField }
                .first { $0.identifier?.rawValue == id })?.stringValue ?? ""
        }

        KioskPrefs.shared.startUrl = fieldValue("url")
        if let port = UInt16(fieldValue("port")) {
            KioskPrefs.shared.httpPort = port
        }
        KioskPrefs.shared.httpPassword = fieldValue("pw")
        KioskPrefs.shared.settingsPassword = fieldValue("settingsPw")
        KioskPrefs.shared.screenTimeout = Int(fieldValue("timeout")) ?? 0
        KioskPrefs.shared.autoRestartHours = Int(fieldValue("restart")) ?? 0

        print("[Settings] Saved")
        onSave()
    }

    @objc private func quitTapped() {
        onQuit()
    }
}
