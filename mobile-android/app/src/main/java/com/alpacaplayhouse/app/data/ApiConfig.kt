package com.alpacaplayhouse.app.data

object ApiConfig {
    const val SONOS_BASE_URL = "http://192.168.1.200:5005"
    const val LIGHTS_BASE_URL = "http://192.168.1.200:8100"
    const val HAOS_BASE_URL = "http://192.168.1.39:8123"
    // Device credentials must be supplied by an authenticated backend proxy.
    const val HAOS_TOKEN = ""

    // Supabase
    const val SUPABASE_URL = "https://aphrrfprbixmhissnjfn.supabase.co"
    const val SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwaHJyZnByYml4bWhpc3NuamZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5MzA0MjUsImV4cCI6MjA4NTUwNjQyNX0.yYkdQIq97GQgxK7yT2OQEPi5Tt-a7gM45aF8xjSD6wk"
    const val OAUTH_REDIRECT_SCHEME = "com.alpacaplayhouse.app"
    const val OAUTH_REDIRECT_URL = "$OAUTH_REDIRECT_SCHEME://auth/callback"

    // Logo URLs
    const val LOGO_LIGHT_URL = "$SUPABASE_URL/storage/v1/object/public/housephotos/logos/alpaca-head-black-transparent.png"
    const val LOGO_DARK_URL = "$SUPABASE_URL/storage/v1/object/public/housephotos/logos/alpaca-head-white-transparent.png"
    const val WORDMARK_LIGHT_URL = "$SUPABASE_URL/storage/v1/object/public/housephotos/logos/wordmark-black-transparent.png"
    const val WORDMARK_DARK_URL = "$SUPABASE_URL/storage/v1/object/public/housephotos/logos/wordmark-white-transparent.png"
}
