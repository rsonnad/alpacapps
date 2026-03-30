import SwiftUI

@main
struct AlpacaPlayhouseApp: App {
    private let auth = AuthService.shared

    var body: some Scene {
        WindowGroup {
            if auth.isLoggedIn {
                ContentView()
            } else {
                LoginView()
            }
        }
    }
}
