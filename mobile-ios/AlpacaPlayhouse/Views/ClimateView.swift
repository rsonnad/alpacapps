import SwiftUI

struct ClimateView: View {
    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                Image(systemName: "thermometer.medium")
                    .font(.system(size: 48))
                    .foregroundStyle(AppTheme.accent)
                Text("Coming soon")
                    .font(.title3)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(AppTheme.light)
            .navigationTitle("Climate")
        }
    }
}

#Preview {
    ClimateView()
}
