// swift-tools-version:5.7
import PackageDescription

let package = Package(
    name: "OldMacKiosk",
    platforms: [.macOS(.v12)],
    targets: [
        .executableTarget(
            name: "OldMacKiosk",
            path: "Sources/OldMacKiosk",
            resources: [
                .copy("../../Resources/offline.html")
            ],
            linkerSettings: [
                .linkedFramework("WebKit"),
                .linkedFramework("AVFoundation"),
                .linkedFramework("CoreWLAN"),
                .linkedFramework("IOKit"),
                .linkedFramework("Network"),
                .linkedFramework("AppKit"),
            ]
        )
    ]
)
