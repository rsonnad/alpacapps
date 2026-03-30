import SwiftUI

struct ContentView: View {
    var body: some View {
        TabView {
            CamerasView()
                .tabItem {
                    Label("Cameras", systemImage: "video.fill")
                }

            MusicView()
                .tabItem {
                    Label("Music", systemImage: "music.note")
                }

            LightsView()
                .tabItem {
                    Label("Lights", systemImage: "lightbulb.fill")
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
        .tint(AppTheme.accent)
    }
}

#Preview {
    ContentView()
}
