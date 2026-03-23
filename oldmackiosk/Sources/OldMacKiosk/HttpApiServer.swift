import Foundation
import Network

// MARK: - HttpApiServer — Remote control HTTP server (port 2323)

class HttpApiServer {
    private var listener: NWListener?
    private let webViewController: WebViewController
    private let screenManager: ScreenManager
    private let onShowSettings: () -> Void
    private let startTime = Date()

    init(webViewController: WebViewController, screenManager: ScreenManager, onShowSettings: @escaping () -> Void) {
        self.webViewController = webViewController
        self.screenManager = screenManager
        self.onShowSettings = onShowSettings
    }

    func start() {
        let port = KioskPrefs.shared.httpPort
        guard let nwPort = NWEndpoint.Port(rawValue: port) else {
            print("[HTTP] Invalid port: \(port)")
            return
        }

        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = true

        do {
            listener = try NWListener(using: params, on: nwPort)
        } catch {
            print("[HTTP] Failed to create listener: \(error)")
            return
        }

        listener?.newConnectionHandler = { [weak self] connection in
            self?.handleConnection(connection)
        }

        listener?.stateUpdateHandler = { state in
            switch state {
            case .ready:
                print("[HTTP] Server listening on port \(port)")
            case .failed(let error):
                print("[HTTP] Server failed: \(error)")
            default:
                break
            }
        }

        listener?.start(queue: .global(qos: .userInteractive))
    }

    func stop() {
        listener?.cancel()
        listener = nil
    }

    // MARK: - Connection Handling

    private func handleConnection(_ connection: NWConnection) {
        connection.start(queue: .global(qos: .userInteractive))
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, _, error in
            guard let self = self, let data = data else {
                connection.cancel()
                return
            }

            let request = String(data: data, encoding: .utf8) ?? ""
            self.routeRequest(request, connection: connection)
        }
    }

    private func routeRequest(_ raw: String, connection: NWConnection) {
        let lines = raw.components(separatedBy: "\r\n")
        guard let requestLine = lines.first else {
            sendResponse(connection, status: 400, body: "{\"error\":\"bad request\"}")
            return
        }

        let parts = requestLine.split(separator: " ")
        guard parts.count >= 2 else {
            sendResponse(connection, status: 400, body: "{\"error\":\"bad request\"}")
            return
        }

        let method = String(parts[0])
        let fullPath = String(parts[1])

        // Parse path and query params
        let components = URLComponents(string: fullPath)
        let path = components?.path ?? fullPath
        var queryParams: [String: String] = [:]
        components?.queryItems?.forEach { queryParams[$0.name] = $0.value }

        // Extract body for POST requests
        let bodyString: String
        if let bodyStart = raw.range(of: "\r\n\r\n") {
            bodyString = String(raw[bodyStart.upperBound...])
        } else {
            bodyString = ""
        }

        // Auth check (everything except /ping)
        if path != "/ping" {
            let pw = queryParams["pw"] ?? ""
            if pw != KioskPrefs.shared.httpPassword {
                sendResponse(connection, status: 401, body: "{\"error\":\"unauthorized\"}")
                return
            }
        }

        // Route
        switch (method, path) {
        case ("GET", "/ping"):
            sendResponse(connection, status: 200, body: "{\"status\":\"ok\",\"app\":\"oldmackiosk\"}")

        case ("GET", "/status"):
            handleStatus(connection)

        case ("GET", "/screenshot"):
            handleScreenshot(connection)

        case ("POST", "/reload"):
            DispatchQueue.main.async { self.webViewController.reload() }
            sendResponse(connection, status: 200, body: "{\"ok\":true}")

        case ("POST", "/navigate"):
            if let url = queryParams["url"] {
                DispatchQueue.main.async { self.webViewController.loadURL(url) }
                sendResponse(connection, status: 200, body: "{\"ok\":true,\"url\":\"\(url)\"}")
            } else {
                sendResponse(connection, status: 400, body: "{\"error\":\"missing url param\"}")
            }

        case ("POST", "/screen/on"):
            screenManager.wakeScreen()
            sendResponse(connection, status: 200, body: "{\"ok\":true}")

        case ("POST", "/screen/off"):
            screenManager.sleepScreen()
            sendResponse(connection, status: 200, body: "{\"ok\":true}")

        case ("POST", "/brightness"):
            if let levelStr = queryParams["level"], let level = Int(levelStr) {
                screenManager.setBrightness(Float(level) / 100.0)
                sendResponse(connection, status: 200, body: "{\"ok\":true,\"level\":\(level)}")
            } else {
                sendResponse(connection, status: 400, body: "{\"error\":\"missing level param (0-100)\"}")
            }

        case ("POST", "/volume"):
            if let levelStr = queryParams["level"], let level = Int(levelStr) {
                ScreenManager.setVolume(Float(level) / 100.0)
                sendResponse(connection, status: 200, body: "{\"ok\":true,\"level\":\(level)}")
            } else {
                sendResponse(connection, status: 400, body: "{\"error\":\"missing level param (0-100)\"}")
            }

        case ("POST", "/js"):
            DispatchQueue.main.async {
                self.webViewController.executeJS(bodyString) { result in
                    let res = result ?? "null"
                    let escaped = res.replacingOccurrences(of: "\"", with: "\\\"")
                    self.sendResponse(connection, status: 200, body: "{\"result\":\"\(escaped)\"}")
                }
            }

        case ("POST", "/mode/photobooth"):
            DispatchQueue.main.async {
                self.webViewController.loadURL(KioskPrefs.shared.startUrl + "?mode=photobooth")
            }
            sendResponse(connection, status: 200, body: "{\"ok\":true,\"mode\":\"photobooth\"}")

        case ("POST", "/mode/dashboard"):
            DispatchQueue.main.async {
                self.webViewController.loadURL("https://alpacaplayhouse.com/kioskhall/tv.html?mode=dashboard")
            }
            sendResponse(connection, status: 200, body: "{\"ok\":true,\"mode\":\"dashboard\"}")

        case ("POST", "/mode/cameras"):
            DispatchQueue.main.async {
                self.webViewController.loadURL("https://alpacaplayhouse.com/kioskhall/tv.html?mode=cameras")
            }
            sendResponse(connection, status: 200, body: "{\"ok\":true,\"mode\":\"cameras\"}")

        case ("POST", "/mode/signage"):
            let title = queryParams["title"] ?? ""
            let subtitle = queryParams["subtitle"] ?? ""
            let encoded = "title=\(title)&subtitle=\(subtitle)".addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
            DispatchQueue.main.async {
                self.webViewController.loadURL("https://alpacaplayhouse.com/kioskhall/tv.html?mode=signage&\(encoded)")
            }
            sendResponse(connection, status: 200, body: "{\"ok\":true,\"mode\":\"signage\"}")

        case ("POST", "/say"):
            if let text = queryParams["text"] {
                // Use the macOS `say` command for text-to-speech
                let process = Process()
                process.executableURL = URL(fileURLWithPath: "/usr/bin/say")
                process.arguments = [text]
                try? process.run()
                sendResponse(connection, status: 200, body: "{\"ok\":true}")
            } else {
                sendResponse(connection, status: 400, body: "{\"error\":\"missing text param\"}")
            }

        case ("POST", "/reboot"):
            sendResponse(connection, status: 200, body: "{\"ok\":true,\"action\":\"rebooting\"}")
            DispatchQueue.global().asyncAfter(deadline: .now() + 1) {
                let script = "osascript -e 'tell application \"System Events\" to restart'"
                _ = try? Process.run(URL(fileURLWithPath: "/bin/bash"), arguments: ["-c", script])
            }

        case ("POST", "/settings"):
            DispatchQueue.main.async { self.onShowSettings() }
            sendResponse(connection, status: 200, body: "{\"ok\":true}")

        default:
            sendResponse(connection, status: 404, body: "{\"error\":\"not found\",\"path\":\"\(path)\"}")
        }
    }

    // MARK: - Handlers

    private func handleStatus(_ connection: NWConnection) {
        let uptime = Int(Date().timeIntervalSince(startTime))
        let info = ScreenManager.deviceInfoDict()
        let json = """
        {
            "app": "oldmackiosk",
            "version": "1.0.0",
            "uptime_seconds": \(uptime),
            "hostname": "\(info["hostname"] ?? "unknown")",
            "mac_os_version": "\(info["osVersion"] ?? "unknown")",
            "model": "\(info["model"] ?? "unknown")",
            "battery_percent": \(info["batteryPercent"] ?? "-1"),
            "battery_charging": \(info["batteryCharging"] ?? "false"),
            "wifi_ssid": "\(info["wifiSSID"] ?? "unknown")",
            "wifi_rssi": \(info["wifiRSSI"] ?? "0"),
            "screen_on": true,
            "current_url": "\(KioskPrefs.shared.startUrl)"
        }
        """
        sendResponse(connection, status: 200, body: json)
    }

    private func handleScreenshot(_ connection: NWConnection) {
        DispatchQueue.main.async {
            self.webViewController.captureScreenshot { jpegData in
                if let data = jpegData {
                    let header = "HTTP/1.1 200 OK\r\nContent-Type: image/jpeg\r\nContent-Length: \(data.count)\r\nConnection: close\r\n\r\n"
                    var responseData = header.data(using: .utf8)!
                    responseData.append(data)
                    connection.send(content: responseData, completion: .contentProcessed { _ in
                        connection.cancel()
                    })
                } else {
                    self.sendResponse(connection, status: 500, body: "{\"error\":\"screenshot failed\"}")
                }
            }
        }
    }

    // MARK: - Response Helper

    private func sendResponse(_ connection: NWConnection, status: Int, body: String, contentType: String = "application/json") {
        let statusText: String
        switch status {
        case 200: statusText = "OK"
        case 400: statusText = "Bad Request"
        case 401: statusText = "Unauthorized"
        case 404: statusText = "Not Found"
        case 500: statusText = "Internal Server Error"
        default: statusText = "Unknown"
        }

        let response = "HTTP/1.1 \(status) \(statusText)\r\nContent-Type: \(contentType)\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n\(body)"
        let data = response.data(using: .utf8)!
        connection.send(content: data, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }
}
