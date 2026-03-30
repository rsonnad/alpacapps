import SwiftUI

struct MusicView: View {
    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                Image(systemName: "music.note")
                    .font(.system(size: 48))
                    .foregroundStyle(AppTheme.accent)
                Text("Coming soon")
                    .font(.title3)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(AppTheme.light)
            .navigationTitle("Music")
        }
    }
}

#Preview {
    MusicView()
}
