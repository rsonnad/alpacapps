import AppKit

// MARK: - KioskWindow — Fullscreen borderless window

class KioskWindow: NSWindow {

    init() {
        let screen = NSScreen.main ?? NSScreen.screens[0]
        super.init(
            contentRect: screen.frame,
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )

        self.level = .statusBar + 1  // Above most windows
        self.isOpaque = true
        self.hasShadow = false
        self.backgroundColor = .black
        self.collectionBehavior = [.fullScreenPrimary, .ignoresCycle]
        self.acceptsMouseMovedEvents = true
        self.isReleasedWhenClosed = false

        // Fill the entire screen
        self.setFrame(screen.frame, display: true)
    }

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }

    /// Prevent window from being moved
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
        return screen?.frame ?? frameRect
    }
}
