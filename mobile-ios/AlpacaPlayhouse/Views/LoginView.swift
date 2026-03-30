import SwiftUI

struct LoginView: View {
    @Environment(\.colorScheme) private var colorScheme
    let auth = AuthService.shared

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            // Logo
            AsyncImage(url: colorScheme == .dark ? AppTheme.logoDarkURL : AppTheme.logoLightURL) { image in
                image.resizable().scaledToFit()
            } placeholder: {
                ProgressView()
            }
            .frame(width: 96, height: 96)
            .clipShape(RoundedRectangle(cornerRadius: 16))

            Spacer().frame(height: 16)

            // Wordmark
            AsyncImage(url: colorScheme == .dark ? AppTheme.wordmarkDarkURL : AppTheme.wordmarkLightURL) { image in
                image.resizable().scaledToFit()
            } placeholder: {
                EmptyView()
            }
            .frame(height: 32)

            Spacer().frame(height: 48)

            Text("Welcome")
                .font(.title)
                .fontWeight(.semibold)

            Spacer().frame(height: 8)

            Text("Sign in to control your smart home,\nmanage work, and more.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            Spacer().frame(height: 32)

            Button {
                Task { await auth.signInWithGoogle() }
            } label: {
                Text("Sign in with Google")
                    .font(.headline)
                    .fontWeight(.medium)
                    .frame(maxWidth: .infinity)
                    .frame(height: 52)
                    .background(AppTheme.primary)
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .padding(.horizontal, 32)

            Spacer()

            Text("Alpaca Playhouse Austin")
                .font(.caption)
                .foregroundStyle(.tertiary)

            Spacer().frame(height: 32)
        }
    }
}
