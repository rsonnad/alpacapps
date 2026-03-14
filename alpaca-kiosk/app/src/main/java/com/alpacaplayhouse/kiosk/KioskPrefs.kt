package com.alpacaplayhouse.kiosk

import android.content.Context
import android.content.SharedPreferences

class KioskPrefs(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences("kiosk_prefs", Context.MODE_PRIVATE)

    companion object {
        private const val KEY_START_URL = "start_url"
        private const val KEY_HTTP_PORT = "http_port"
        private const val KEY_HTTP_PASSWORD = "http_password"
        private const val KEY_SETTINGS_PASSWORD = "settings_password"
        private const val KEY_SCREEN_TIMEOUT = "screen_timeout"
        private const val KEY_WAKE_ON_MOTION = "wake_on_motion"
        private const val KEY_AUTO_RESTART_HOURS = "auto_restart_hours"
        private const val KEY_SUPABASE_URL = "supabase_url"
        private const val KEY_SUPABASE_KEY = "supabase_key"

        private const val DEFAULT_URL = "https://alpacaplayhouse.com/kioskhall/"
        private const val DEFAULT_PORT = 2323
        private const val DEFAULT_HTTP_PW = "alpaca2323"
        private const val DEFAULT_SETTINGS_PW = "1234"
    }

    var startUrl: String
        get() = prefs.getString(KEY_START_URL, DEFAULT_URL) ?: DEFAULT_URL
        set(value) = prefs.edit().putString(KEY_START_URL, value).apply()

    var httpPort: Int
        get() = prefs.getInt(KEY_HTTP_PORT, DEFAULT_PORT)
        set(value) = prefs.edit().putInt(KEY_HTTP_PORT, value).apply()

    var httpPassword: String
        get() = prefs.getString(KEY_HTTP_PASSWORD, DEFAULT_HTTP_PW) ?: DEFAULT_HTTP_PW
        set(value) = prefs.edit().putString(KEY_HTTP_PASSWORD, value).apply()

    var settingsPassword: String
        get() = prefs.getString(KEY_SETTINGS_PASSWORD, DEFAULT_SETTINGS_PW) ?: DEFAULT_SETTINGS_PW
        set(value) = prefs.edit().putString(KEY_SETTINGS_PASSWORD, value).apply()

    var screenTimeout: Int
        get() = prefs.getInt(KEY_SCREEN_TIMEOUT, 0)
        set(value) = prefs.edit().putInt(KEY_SCREEN_TIMEOUT, value).apply()

    var wakeOnMotion: Boolean
        get() = prefs.getBoolean(KEY_WAKE_ON_MOTION, false)
        set(value) = prefs.edit().putBoolean(KEY_WAKE_ON_MOTION, value).apply()

    var autoRestartHours: Int
        get() = prefs.getInt(KEY_AUTO_RESTART_HOURS, 0)
        set(value) = prefs.edit().putInt(KEY_AUTO_RESTART_HOURS, value).apply()

    var supabaseUrl: String
        get() = prefs.getString(KEY_SUPABASE_URL, "") ?: ""
        set(value) = prefs.edit().putString(KEY_SUPABASE_URL, value).apply()

    var supabaseKey: String
        get() = prefs.getString(KEY_SUPABASE_KEY, "") ?: ""
        set(value) = prefs.edit().putString(KEY_SUPABASE_KEY, value).apply()
}
