import SwiftUI

struct ContentView: View {
    @State private var capabilities: UserCapabilities?

    var body: some View {
        TabView {
            AssistantView()
                .tabItem {
                    Label("Home", systemImage: "house.fill")
                }

            MusicView()
                .tabItem {
                    Label("Music", systemImage: "music.note")
                }

            LightsView()
                .tabItem {
                    Label("Lights", systemImage: "lightbulb.fill")
                }

            WorkView()
                .tabItem {
                    Label("Work", systemImage: "briefcase.fill")
                }

            if capabilities?.showClimate == true {
                ClimateView()
                    .tabItem {
                        Label("Climate", systemImage: "thermometer.medium")
                    }
            }

            if capabilities?.showCars == true {
                CarsView()
                    .tabItem {
                        Label("Cars", systemImage: "car.fill")
                    }
            }
        }
        .tint(AppTheme.primary)
        .task {
            capabilities = await UserCapabilities.load()
        }
    }
}

struct UserCapabilities {
    let isAdmin: Bool
    let hasThermostat: Bool
    let hasTesla: Bool

    var showClimate: Bool { isAdmin || hasThermostat }
    var showCars: Bool { isAdmin || hasTesla }

    static func load() async -> UserCapabilities {
        let role = AuthService.shared.userRole
        let isAdmin = role == "admin" || role == "staff"

        if isAdmin {
            return UserCapabilities(isAdmin: true, hasThermostat: true, hasTesla: true)
        }

        let token = AuthService.shared.accessToken ?? ApiConfig.supabaseAnonKey

        // Check thermostats in assigned spaces
        var hasThermostat = false
        if let data = try? await supabaseGet("nest_devices?select=id&is_active=eq.true&limit=1", token: token) {
            hasThermostat = data != "[]"
        }

        // Check Tesla vehicles
        var hasTesla = false
        if let data = try? await supabaseGet("vehicles?select=id&is_active=eq.true&make=ilike.tesla&limit=1", token: token) {
            hasTesla = data != "[]"
        }

        return UserCapabilities(isAdmin: false, hasThermostat: hasThermostat, hasTesla: hasTesla)
    }

    private static func supabaseGet(_ path: String, token: String) async throws -> String {
        var request = URLRequest(url: URL(string: "\(ApiConfig.supabaseURL)/rest/v1/\(path)")!)
        request.setValue(ApiConfig.supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, _) = try await URLSession.shared.data(for: request)
        return String(data: data, encoding: .utf8) ?? "[]"
    }
}

#Preview {
    ContentView()
}
