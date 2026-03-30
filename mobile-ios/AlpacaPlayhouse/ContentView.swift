import SwiftUI

struct ContentView: View {
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

            ClimateView()
                .tabItem {
                    Label("Climate", systemImage: "thermometer.medium")
                }

            CarsView()
                .tabItem {
                    Label("Cars", systemImage: "car.fill")
                }
        }
        .tint(AppTheme.primary)
    }
}

#Preview {
    ContentView()
}
