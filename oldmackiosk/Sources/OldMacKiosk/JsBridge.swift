import AppKit
import WebKit
import AVFoundation

// MARK: - JsBridge — Native ↔ JS message handlers (window.OldMacKiosk)

class JsBridge: NSObject, WKScriptMessageHandler {
    weak var viewController: WebViewController?
    private var cameraManager: CameraManager?
    private var audioManager: AudioManager?

    init(viewController: WebViewController) {
        self.viewController = viewController
        super.init()
    }

    /// JavaScript injected at document start to expose window.OldMacKiosk
    static var injectionScript: String {
        return """
        window.OldMacKiosk = {
            _callbacks: {},
            _cbId: 0,

            _call: function(method, args, callback) {
                var msg = { method: method, args: args || {} };
                if (callback) {
                    var id = ++this._cbId;
                    this._callbacks[id] = callback;
                    msg.callbackId = id;
                }
                window.webkit.messageHandlers.oldmackiosk.postMessage(JSON.stringify(msg));
            },

            _onCallback: function(id, data) {
                var cb = this._callbacks[id];
                if (cb) { cb(data); delete this._callbacks[id]; }
            },

            openPhotoBooth: function(cb) { this._call('openPhotoBooth', {}, cb); },
            getDeviceInfo: function(cb) { this._call('getDeviceInfo', {}, cb); },
            setBrightness: function(level) { this._call('setBrightness', {level: level}); },
            setVolume: function(level) { this._call('setVolume', {level: level}); },
            speak: function(text) { this._call('speak', {text: text}); },
            startAudioRecording: function() { this._call('startAudioRecording'); },
            stopAudioRecording: function(cb) { this._call('stopAudioRecording', {}, cb); },
            reload: function() { this._call('reload'); },
            getAppVersion: function(cb) { this._call('getAppVersion', {}, cb); },

            // Detect platform
            platform: 'macos',
            isOldMacKiosk: true
        };

        // Dispatch event so web code can detect the bridge
        window.dispatchEvent(new CustomEvent('OldMacKioskReady'));
        """
    }

    // MARK: - WKScriptMessageHandler

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? String,
              let data = body.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let method = json["method"] as? String else {
            print("[JsBridge] Invalid message")
            return
        }

        let args = json["args"] as? [String: Any] ?? [:]
        let callbackId = json["callbackId"] as? Int

        print("[JsBridge] Call: \(method)")

        switch method {
        case "getDeviceInfo":
            let info = ScreenManager.deviceInfoJSON()
            sendCallback(callbackId, data: info)

        case "getAppVersion":
            sendCallback(callbackId, data: "\"1.0.0\"")

        case "setBrightness":
            if let level = args["level"] as? Int {
                ScreenManager().setBrightness(Float(level) / 100.0)
            }

        case "setVolume":
            if let level = args["level"] as? Int {
                ScreenManager.setVolume(Float(level) / 100.0)
            }

        case "speak":
            if let text = args["text"] as? String {
                let process = Process()
                process.executableURL = URL(fileURLWithPath: "/usr/bin/say")
                process.arguments = [text]
                try? process.run()
            }

        case "reload":
            DispatchQueue.main.async { [weak self] in
                self?.viewController?.reload()
            }

        case "openPhotoBooth":
            DispatchQueue.main.async { [weak self] in
                guard let vc = self?.viewController else { return }
                let cam = CameraManager()
                self?.cameraManager = cam
                cam.capturePhoto(in: vc.view) { jpegData in
                    if let data = jpegData {
                        let base64 = data.base64EncodedString()
                        self?.sendCallback(callbackId, data: "\"\(base64)\"")
                    } else {
                        self?.sendCallback(callbackId, data: "null")
                    }
                    self?.cameraManager = nil
                }
            }

        case "startAudioRecording":
            let audio = AudioManager()
            self.audioManager = audio
            audio.startRecording()

        case "stopAudioRecording":
            audioManager?.stopRecording { [weak self] data in
                if let data = data {
                    let base64 = data.base64EncodedString()
                    self?.sendCallback(callbackId, data: "\"\(base64)\"")
                } else {
                    self?.sendCallback(callbackId, data: "null")
                }
                self?.audioManager = nil
            }

        default:
            print("[JsBridge] Unknown method: \(method)")
        }
    }

    private func sendCallback(_ callbackId: Int?, data: String) {
        guard let id = callbackId else { return }
        let js = "window.OldMacKiosk._onCallback(\(id), \(data));"
        DispatchQueue.main.async { [weak self] in
            self?.viewController?.executeJS(js, completion: nil)
        }
    }
}
