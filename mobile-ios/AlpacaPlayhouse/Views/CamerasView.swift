import SwiftUI

struct CamerasView: View {
    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                Image(systemName: "video.fill")
                    .font(.system(size: 48))
                    .foregroundStyle(AppTheme.accent)
                Text("Coming soon")
                    .font(.title3)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(AppTheme.light)
            .navigationTitle("Cameras")
        }
    }
}

#Preview {
    CamerasView()
}
