import AppKit
import WebKit
import Network

// MARK: - WebViewController — WKWebView + JS bridge + offline fallback

class WebViewController: NSViewController, WKNavigationDelegate, WKUIDelegate {
    private(set) var webView: WKWebView!
    private var jsBridge: JsBridge!
    private var networkMonitor: NWPathMonitor?
    private var retryTimer: Timer?
    private var currentURL: String = ""
    private var autoRestartTimer: Timer?

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        config.mediaTypesRequiringUserActionForPlayback = []
        config.allowsAirPlayForMediaPlayback = true

        // Set up JS bridge
        jsBridge = JsBridge(viewController: self)
        config.userContentController.add(jsBridge, name: "oldmackiosk")

        // Inject the bridge script so web can call window.OldMacKiosk.method()
        let bridgeScript = WKUserScript(
            source: JsBridge.injectionScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: false
        )
        config.userContentController.addUserScript(bridgeScript)

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsMagnification = false

        // Dark background while loading
        webView.setValue(false, forKey: "drawsBackground")
        webView.wantsLayer = true
        webView.layer?.backgroundColor = NSColor.black.cgColor

        self.view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        startNetworkMonitor()
        startAutoRestartTimer()
    }

    // MARK: - Navigation

    func loadURL(_ urlString: String) {
        currentURL = urlString
        guard let url = URL(string: urlString) else {
            print("[WebView] Invalid URL: \(urlString)")
            showOffline()
            return
        }
        let request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        webView.load(request)
        print("[WebView] Loading: \(urlString)")
    }

    func reload() {
        if currentURL.isEmpty {
            currentURL = KioskPrefs.shared.startUrl
        }
        loadURL(currentURL)
    }

    func executeJS(_ script: String, completion: ((String?) -> Void)? = nil) {
        webView.evaluateJavaScript(script) { result, error in
            if let error = error {
                completion?("Error: \(error.localizedDescription)")
            } else if let result = result {
                completion?("\(result)")
            } else {
                completion?(nil)
            }
        }
    }

    func captureScreenshot(completion: @escaping (Data?) -> Void) {
        let config = WKSnapshotConfiguration()
        config.snapshotWidth = NSNumber(value: Int(webView.bounds.width))
        webView.takeSnapshot(with: config) { image, error in
            guard let image = image else {
                completion(nil)
                return
            }
            let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil)
            guard let cg = cgImage else { completion(nil); return }
            let rep = NSBitmapImageRep(cgImage: cg)
            let jpegData = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.7])
            completion(jpegData)
        }
    }

    // MARK: - Offline Fallback

    private func showOffline() {
        let html = """
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
        <style>
            body { background: #110e10; color: #e99c48; font-family: -apple-system, system-ui;
                   display: flex; flex-direction: column; align-items: center; justify-content: center;
                   height: 100vh; margin: 0; }
            .emoji { font-size: 120px; margin-bottom: 20px; }
            h1 { font-size: 36px; margin: 0 0 10px; }
            p { color: #888; font-size: 18px; }
            .dot { animation: blink 1.5s infinite; }
            @keyframes blink { 0%,20% { opacity: 1; } 50% { opacity: 0; } 80%,100% { opacity: 1; } }
        </style>
        </head>
        <body>
            <div class="emoji">🦙</div>
            <h1>No Connection</h1>
            <p>Retrying<span class="dot">.</span><span class="dot" style="animation-delay:.3s">.</span><span class="dot" style="animation-delay:.6s">.</span></p>
        </body>
        </html>
        """
        webView.loadHTMLString(html, baseURL: nil)
        scheduleRetry()
    }

    private func scheduleRetry() {
        retryTimer?.invalidate()
        retryTimer = Timer.scheduledTimer(withTimeInterval: 10, repeats: false) { [weak self] _ in
            self?.reload()
        }
    }

    // MARK: - Network Monitor

    private func startNetworkMonitor() {
        networkMonitor = NWPathMonitor()
        networkMonitor?.pathUpdateHandler = { [weak self] path in
            if path.status == .satisfied {
                DispatchQueue.main.async {
                    self?.retryTimer?.invalidate()
                    self?.reload()
                }
            }
        }
        networkMonitor?.start(queue: DispatchQueue.global(qos: .utility))
    }

    // MARK: - Auto Restart Timer

    private func startAutoRestartTimer() {
        let hours = KioskPrefs.shared.autoRestartHours
        guard hours > 0 else { return }
        autoRestartTimer = Timer.scheduledTimer(withTimeInterval: Double(hours) * 3600, repeats: true) { [weak self] _ in
            print("[WebView] Auto-restart reload")
            self?.reload()
        }
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        print("[WebView] Navigation failed: \(error.localizedDescription)")
        showOffline()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        print("[WebView] Provisional navigation failed: \(error.localizedDescription)")
        showOffline()
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        // Keep all navigation inside the WebView
        decisionHandler(.allow)
    }

    // MARK: - WKUIDelegate — handle permission requests

    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        // Auto-grant camera/mic for kiosk pages
        decisionHandler(.grant)
    }
}
