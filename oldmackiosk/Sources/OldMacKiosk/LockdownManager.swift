import AppKit

// MARK: - LockdownManager — Disable keys, hide dock/menu, triple-tap escape

class LockdownManager {
    private let window: KioskWindow
    private let onTripleTap: () -> Void
    private var eventMonitor: Any?

    // Triple-tap tracking (bottom-right corner)
    private var tapCount = 0
    private var lastTapTime: Date = .distantPast
    private let tapTimeout: TimeInterval = 1.5  // seconds between taps
    private let cornerSize: CGFloat = 80  // pixels from bottom-right

    init(window: KioskWindow, onTripleTap: @escaping () -> Void) {
        self.window = window
        self.onTripleTap = onTripleTap
    }

    func engage() {
        // Hide dock and menu bar, disable process switching
        NSApplication.shared.presentationOptions = [
            .hideMenuBar,
            .hideDock,
            .disableProcessSwitching,
            .disableForceQuit,
            .disableSessionTermination,
            .disableHideApplication,
        ]

        // Block keyboard shortcuts
        eventMonitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .leftMouseDown]) { [weak self] event in
            return self?.handleEvent(event)
        }

        // Also add global monitor for when another app somehow gets focus
        NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] event in
            let _ = self?.handleEvent(event)
        }

        print("[Lockdown] Engaged — dock/menu hidden, keys blocked")
    }

    func disengage() {
        if let monitor = eventMonitor {
            NSEvent.removeMonitor(monitor)
            eventMonitor = nil
        }
        NSApplication.shared.presentationOptions = []
        print("[Lockdown] Disengaged")
    }

    private func handleEvent(_ event: NSEvent) -> NSEvent? {
        if event.type == .leftMouseDown || event.type == .rightMouseDown {
            checkTripleTap(event)
            return event
        }

        // Block dangerous key combos
        if event.type == .keyDown {
            let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)

            // Block Cmd+Q (quit)
            if flags.contains(.command) && event.charactersIgnoringModifiers == "q" {
                print("[Lockdown] Blocked Cmd+Q")
                return nil
            }
            // Block Cmd+W (close window)
            if flags.contains(.command) && event.charactersIgnoringModifiers == "w" {
                print("[Lockdown] Blocked Cmd+W")
                return nil
            }
            // Block Cmd+Tab (app switch)
            if flags.contains(.command) && event.keyCode == 48 {
                print("[Lockdown] Blocked Cmd+Tab")
                return nil
            }
            // Block Cmd+Space (Spotlight)
            if flags.contains(.command) && event.keyCode == 49 {
                print("[Lockdown] Blocked Cmd+Space")
                return nil
            }
            // Block Cmd+Option+Esc (Force Quit)
            if flags.contains([.command, .option]) && event.keyCode == 53 {
                print("[Lockdown] Blocked Cmd+Opt+Esc")
                return nil
            }
            // Block Cmd+H (hide)
            if flags.contains(.command) && event.charactersIgnoringModifiers == "h" {
                print("[Lockdown] Blocked Cmd+H")
                return nil
            }
            // Block Cmd+M (minimize)
            if flags.contains(.command) && event.charactersIgnoringModifiers == "m" {
                print("[Lockdown] Blocked Cmd+M")
                return nil
            }
        }

        return event
    }

    // MARK: - Triple-tap detection (bottom-right corner)

    private func checkTripleTap(_ event: NSEvent) {
        let location = event.locationInWindow
        let windowFrame = window.frame

        // Check if tap is in bottom-right corner
        let isInCorner = location.x > (windowFrame.width - cornerSize)
            && location.y < cornerSize

        guard isInCorner else {
            tapCount = 0
            return
        }

        let now = Date()
        if now.timeIntervalSince(lastTapTime) > tapTimeout {
            tapCount = 0
        }

        tapCount += 1
        lastTapTime = now

        if tapCount >= 3 {
            tapCount = 0
            print("[Lockdown] Triple-tap detected — opening settings")
            onTripleTap()
        }
    }
}
