import Foundation
import AppKit
import IOKit
import IOKit.ps
import IOKit.pwr_mgt
import CoreWLAN

// MARK: - ScreenManager — Brightness, sleep, wake, volume, device info

class ScreenManager {
    private var sleepAssertionID: IOPMAssertionID = 0
    private var isPreventingSleep = false

    // MARK: - Prevent Sleep

    func preventSleep() {
        guard !isPreventingSleep else { return }
        let result = IOPMAssertionCreateWithName(
            kIOPMAssertionTypeNoDisplaySleep as CFString,
            IOPMAssertionLevel(kIOPMAssertionLevelOn),
            "OldMacKiosk keeping display awake" as CFString,
            &sleepAssertionID
        )
        if result == kIOReturnSuccess {
            isPreventingSleep = true
            print("[Screen] Sleep prevention enabled")
        }
    }

    func allowSleep() {
        guard isPreventingSleep else { return }
        IOPMAssertionRelease(sleepAssertionID)
        isPreventingSleep = false
        print("[Screen] Sleep prevention disabled")
    }

    // MARK: - Brightness

    func setBrightness(_ level: Float) {
        let clamped = min(max(level, 0.0), 1.0)
        // Use osascript with brightness CLI tool, falling back gracefully
        let script = """
        try
            do shell script "brightness \(clamped)"
        end try
        """
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", script]
        try? process.run()
        print("[Screen] Set brightness to \(Int(clamped * 100))%")
    }

    // MARK: - Sleep / Wake

    func sleepScreen() {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/pmset")
        process.arguments = ["displaysleepnow"]
        try? process.run()
        print("[Screen] Display sleep")
    }

    func wakeScreen() {
        // Wake by creating a caffeinate assertion briefly
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/caffeinate")
        process.arguments = ["-u", "-t", "2"]
        try? process.run()
        print("[Screen] Display wake")
    }

    // MARK: - Volume

    static func setVolume(_ level: Float) {
        let clamped = Int(min(max(level, 0.0), 1.0) * 100)
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", "set volume output volume \(clamped)"]
        try? process.run()
        print("[Screen] Set volume to \(clamped)%")
    }

    // MARK: - Device Info

    static func deviceInfoDict() -> [String: String] {
        var info: [String: String] = [:]

        // Hostname
        info["hostname"] = ProcessInfo.processInfo.hostName

        // macOS version
        let os = ProcessInfo.processInfo.operatingSystemVersion
        info["osVersion"] = "\(os.majorVersion).\(os.minorVersion).\(os.patchVersion)"

        // Model
        info["model"] = getMacModel()

        // Battery
        let battery = getBatteryInfo()
        info["batteryPercent"] = "\(battery.percent)"
        info["batteryCharging"] = battery.charging ? "true" : "false"

        // WiFi
        let wifi = getWiFiInfo()
        info["wifiSSID"] = wifi.ssid
        info["wifiRSSI"] = "\(wifi.rssi)"

        // Uptime
        info["uptime"] = "\(Int(ProcessInfo.processInfo.systemUptime))"

        return info
    }

    static func deviceInfoJSON() -> String {
        let info = deviceInfoDict()
        let pairs = info.map { key, value -> String in
            // Numbers don't need quotes
            if ["batteryPercent", "wifiRSSI", "uptime"].contains(key) {
                return "\"\(key)\": \(value)"
            }
            if key == "batteryCharging" {
                return "\"\(key)\": \(value)"
            }
            return "\"\(key)\": \"\(value)\""
        }
        return "{\(pairs.joined(separator: ", "))}"
    }

    // MARK: - Helpers

    private static func getMacModel() -> String {
        var size = 0
        sysctlbyname("hw.model", nil, &size, nil, 0)
        var model = [CChar](repeating: 0, count: size)
        sysctlbyname("hw.model", &model, &size, nil, 0)
        return String(cString: model)
    }

    private static func getBatteryInfo() -> (percent: Int, charging: Bool) {
        guard let snapshot = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
              let sources = IOPSCopyPowerSourcesList(snapshot)?.takeRetainedValue() as? [CFTypeRef],
              let source = sources.first,
              let desc = IOPSGetPowerSourceDescription(snapshot, source)?.takeUnretainedValue() as? [String: Any] else {
            return (percent: -1, charging: false)
        }

        let percent = desc[kIOPSCurrentCapacityKey] as? Int ?? -1
        let charging = (desc[kIOPSIsChargingKey] as? Bool) ?? false
        return (percent: percent, charging: charging)
    }

    private static func getWiFiInfo() -> (ssid: String, rssi: Int) {
        guard let client = CWWiFiClient.shared().interface() else {
            return (ssid: "unknown", rssi: 0)
        }
        let ssid = client.ssid() ?? "unknown"
        let rssi = client.rssiValue()
        return (ssid: ssid, rssi: rssi)
    }
}
