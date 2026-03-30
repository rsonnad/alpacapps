import SwiftUI

enum AppTheme {
    // Brand colors — from style guide (Current Teal palette)
    static let primary = Color(red: 0x3D / 255.0, green: 0x8B / 255.0, blue: 0x7A / 255.0)       // #3d8b7a teal
    static let primaryLight = Color(red: 0x5A / 255.0, green: 0x9E / 255.0, blue: 0x8F / 255.0)   // #5a9e8f
    static let accent = Color(red: 0xE0 / 255.0, green: 0x7A / 255.0, blue: 0x5F / 255.0)         // #e07a5f warm salmon
    static let background = Color(red: 0xFA / 255.0, green: 0xF9 / 255.0, blue: 0xF7 / 255.0)     // #faf9f7 warm white
    static let text = Color(red: 0x2D / 255.0, green: 0x31 / 255.0, blue: 0x42 / 255.0)           // #2d3142 dark navy
    static let muted = Color(red: 0x7A / 255.0, green: 0x7D / 255.0, blue: 0x8C / 255.0)          // #7a7d8c grey-blue

    // Logo URLs
    static let logoLightURL = URL(string: "https://aphrrfprbixmhissnjfn.supabase.co/storage/v1/object/public/housephotos/logos/alpaca-head-black-transparent.png")!
    static let logoDarkURL = URL(string: "https://aphrrfprbixmhissnjfn.supabase.co/storage/v1/object/public/housephotos/logos/alpaca-head-white-transparent.png")!
    static let wordmarkLightURL = URL(string: "https://aphrrfprbixmhissnjfn.supabase.co/storage/v1/object/public/housephotos/logos/wordmark-black-transparent.png")!
    static let wordmarkDarkURL = URL(string: "https://aphrrfprbixmhissnjfn.supabase.co/storage/v1/object/public/housephotos/logos/wordmark-white-transparent.png")!
}
