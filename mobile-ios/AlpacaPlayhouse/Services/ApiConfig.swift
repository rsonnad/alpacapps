import Foundation

enum ApiConfig {
    static let sonosBaseURL = URL(string: "http://192.168.1.74:5005")!
    static let lightBaseURL = URL(string: "http://192.168.1.200:8100")!
    static let haosBaseURL = URL(string: "http://192.168.1.39:8123")!
    static let haosToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiIxN2FlNmMyNTdhYWY0NGMxODBjZmMxOWU3ZDBiZWExMiIsImlhdCI6MTc3NDE1NTUzNSwiZXhwIjoyMDg5NTE1NTM1fQ.MdIZq95i9pJBKuKxn_aeyrK1O55JbMhsgtnM7GcTkXQ"

    // Supabase
    static let supabaseURL = "https://aphrrfprbixmhissnjfn.supabase.co"
    static let supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwaHJyZnByYml4bWhpc3NuamZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5MzA0MjUsImV4cCI6MjA4NTUwNjQyNX0.yYkdQIq97GQgxK7yT2OQEPi5Tt-a7gM45aF8xjSD6wk"
    static let oauthRedirectScheme = "com.alpacaplayhouse.app"
    static let oauthRedirectURL = "\(oauthRedirectScheme)://auth/callback"
}
