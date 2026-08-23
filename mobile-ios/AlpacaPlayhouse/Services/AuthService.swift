import Foundation
import AuthenticationServices
import Observation

@Observable
final class AuthService {
    static let shared = AuthService()

    var isLoggedIn = false
    var userName: String?
    var userEmail: String?
    var userAvatar: String?
    var accessToken: String?
    var userRole: String?

    private let defaults = UserDefaults.standard
    private let kAccessToken = "auth_access_token"
    private let kRefreshToken = "auth_refresh_token"
    private let kUserName = "auth_user_name"
    private let kUserEmail = "auth_user_email"
    private let kUserAvatar = "auth_user_avatar"
    private let kUserId = "auth_user_id"
    private let kUserRole = "auth_user_role"

    private init() {
        accessToken = defaults.string(forKey: kAccessToken)
        userName = defaults.string(forKey: kUserName)
        userEmail = defaults.string(forKey: kUserEmail)
        userAvatar = defaults.string(forKey: kUserAvatar)
        userRole = defaults.string(forKey: kUserRole)
        isLoggedIn = accessToken != nil
    }

    var googleOAuthURL: URL {
        var components = URLComponents(string: "\(ApiConfig.supabaseURL)/auth/v1/authorize")!
        components.queryItems = [
            URLQueryItem(name: "provider", value: "google"),
            URLQueryItem(name: "redirect_to", value: ApiConfig.oauthRedirectURL),
        ]
        return components.url!
    }

    @MainActor
    func signInWithGoogle() async {
        await withCheckedContinuation { continuation in
            let session = ASWebAuthenticationSession(
                url: googleOAuthURL,
                callbackURLScheme: ApiConfig.oauthRedirectScheme
            ) { callbackURL, error in
                guard let url = callbackURL, error == nil else {
                    continuation.resume()
                    return
                }
                Task {
                    await self.handleCallback(url: url)
                    continuation.resume()
                }
            }
            session.prefersEphemeralWebBrowserSession = false
            session.presentationContextProvider = ASPresentationContextProvider.shared
            session.start()
        }
    }

    func handleCallback(url: URL) async {
        guard let fragment = url.fragment else { return }
        let params = Dictionary(
            uniqueKeysWithValues: fragment.split(separator: "&").compactMap { pair -> (String, String)? in
                let parts = pair.split(separator: "=", maxSplits: 1)
                guard parts.count == 2 else { return nil }
                return (String(parts[0]), String(parts[1]).removingPercentEncoding ?? String(parts[1]))
            }
        )

        guard let token = params["access_token"] else { return }
        let refreshToken = params["refresh_token"] ?? ""

        // Fetch user info
        var request = URLRequest(url: URL(string: "\(ApiConfig.supabaseURL)/auth/v1/user")!)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(ApiConfig.supabaseAnonKey, forHTTPHeaderField: "apikey")

        do {
            let (data, _) = try await URLSession.shared.data(for: request)
            let user = try JSONDecoder().decode(SupabaseUser.self, from: data)

            defaults.set(token, forKey: kAccessToken)
            defaults.set(refreshToken, forKey: kRefreshToken)
            defaults.set(user.id, forKey: kUserId)
            defaults.set(user.email, forKey: kUserEmail)
            defaults.set(user.userMetadata?.fullName ?? user.userMetadata?.name ?? user.email, forKey: kUserName)
            defaults.set(user.userMetadata?.avatarURL, forKey: kUserAvatar)

            // Fetch role from app_users
            let role = await fetchRole(token: token, userId: user.id)
            if let role {
                defaults.set(role, forKey: kUserRole)
            }

            await MainActor.run {
                self.accessToken = token
                self.userName = user.userMetadata?.fullName ?? user.userMetadata?.name ?? user.email
                self.userEmail = user.email
                self.userAvatar = user.userMetadata?.avatarURL
                self.userRole = role
                self.isLoggedIn = true
            }
        } catch {
            print("Auth error: \(error)")
        }
    }

    private func fetchRole(token: String, userId: String) async -> String? {
        var req = URLRequest(url: URL(string: "\(ApiConfig.supabaseURL)/rest/v1/app_users?id=eq.\(userId)&select=role")!)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue(ApiConfig.supabaseAnonKey, forHTTPHeaderField: "apikey")
        guard let (data, _) = try? await URLSession.shared.data(for: req),
              let rows = try? JSONDecoder().decode([[String: String]].self, from: data),
              let role = rows.first?["role"] else { return nil }
        return role
    }

    func logout() {
        defaults.removeObject(forKey: kAccessToken)
        defaults.removeObject(forKey: kRefreshToken)
        defaults.removeObject(forKey: kUserId)
        defaults.removeObject(forKey: kUserEmail)
        defaults.removeObject(forKey: kUserName)
        defaults.removeObject(forKey: kUserAvatar)
        defaults.removeObject(forKey: kUserRole)
        accessToken = nil
        userName = nil
        userEmail = nil
        userAvatar = nil
        userRole = nil
        isLoggedIn = false
    }
}

// MARK: - Models

struct SupabaseUser: Decodable {
    let id: String
    let email: String?
    let userMetadata: UserMetadata?

    enum CodingKeys: String, CodingKey {
        case id, email
        case userMetadata = "user_metadata"
    }

    struct UserMetadata: Decodable {
        let fullName: String?
        let name: String?
        let avatarURL: String?

        enum CodingKeys: String, CodingKey {
            case fullName = "full_name"
            case name
            case avatarURL = "avatar_url"
        }
    }
}

// MARK: - ASWebAuthenticationSession context provider

final class ASPresentationContextProvider: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = ASPresentationContextProvider()

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        ASPresentationAnchor()
    }
}
