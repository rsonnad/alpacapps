package com.alpacaplayhouse.app.data

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.ui.graphics.Color
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request

@Serializable
private data class BrandConfigRow(
    val id: Int? = null,
    val primary_color: String? = null,
    val primary_light: String? = null,
    val accent_color: String? = null,
    val background_color: String? = null,
    val text_color: String? = null,
    val muted_color: String? = null,
    val dark_bg: String? = null,
    val dark_surface: String? = null,
)

data class BrandColors(
    val primary: Color,
    val primaryLight: Color,
    val accent: Color,
    val background: Color,
    val text: Color,
    val muted: Color,
    val darkBg: Color,
    val darkSurface: Color,
)

object BrandConfig {
    private val client = OkHttpClient()
    private val json = Json { ignoreUnknownKeys = true }
    private const val PREFS = "brand_config"

    // Default brand colors (fallback)
    val defaults = BrandColors(
        primary = Color(0xFF3D8B7A),
        primaryLight = Color(0xFF5A9E8F),
        accent = Color(0xFFE07A5F),
        background = Color(0xFFFAF9F7),
        text = Color(0xFF2D3142),
        muted = Color(0xFF7A7D8C),
        darkBg = Color(0xFF1A1E2C),
        darkSurface = Color(0xFF252A3A),
    )

    @Volatile
    var current: BrandColors = defaults
        private set

    fun init(context: Context) {
        // Load cached colors first
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        current = loadFromPrefs(prefs) ?: defaults
    }

    suspend fun refresh(context: Context) = withContext(Dispatchers.IO) {
        try {
            val req = Request.Builder()
                .url("${ApiConfig.SUPABASE_URL}/rest/v1/brand_config?id=eq.1&select=*")
                .addHeader("apikey", ApiConfig.SUPABASE_ANON_KEY)
                .addHeader("Authorization", "Bearer ${AuthManager.accessToken ?: ApiConfig.SUPABASE_ANON_KEY}")
                .build()
            val resp = client.newCall(req).execute()
            val body = resp.body?.string() ?: "[]"
            val rows = json.decodeFromString<List<BrandConfigRow>>(body)
            val row = rows.firstOrNull() ?: return@withContext

            val colors = BrandColors(
                primary = parseColor(row.primary_color) ?: defaults.primary,
                primaryLight = parseColor(row.primary_light) ?: defaults.primaryLight,
                accent = parseColor(row.accent_color) ?: defaults.accent,
                background = parseColor(row.background_color) ?: defaults.background,
                text = parseColor(row.text_color) ?: defaults.text,
                muted = parseColor(row.muted_color) ?: defaults.muted,
                darkBg = parseColor(row.dark_bg) ?: defaults.darkBg,
                darkSurface = parseColor(row.dark_surface) ?: defaults.darkSurface,
            )

            current = colors
            saveToPrefs(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE), colors)
        } catch (_: Exception) { }
    }

    private fun parseColor(hex: String?): Color? {
        if (hex.isNullOrBlank()) return null
        return try {
            val clean = hex.removePrefix("#")
            Color(android.graphics.Color.parseColor("#$clean"))
        } catch (_: Exception) { null }
    }

    private fun saveToPrefs(prefs: SharedPreferences, colors: BrandColors) {
        prefs.edit().apply {
            putInt("primary", colors.primary.toArgb())
            putInt("primaryLight", colors.primaryLight.toArgb())
            putInt("accent", colors.accent.toArgb())
            putInt("background", colors.background.toArgb())
            putInt("text", colors.text.toArgb())
            putInt("muted", colors.muted.toArgb())
            putInt("darkBg", colors.darkBg.toArgb())
            putInt("darkSurface", colors.darkSurface.toArgb())
            putBoolean("cached", true)
            apply()
        }
    }

    private fun loadFromPrefs(prefs: SharedPreferences): BrandColors? {
        if (!prefs.getBoolean("cached", false)) return null
        return BrandColors(
            primary = Color(prefs.getInt("primary", 0)),
            primaryLight = Color(prefs.getInt("primaryLight", 0)),
            accent = Color(prefs.getInt("accent", 0)),
            background = Color(prefs.getInt("background", 0)),
            text = Color(prefs.getInt("text", 0)),
            muted = Color(prefs.getInt("muted", 0)),
            darkBg = Color(prefs.getInt("darkBg", 0)),
            darkSurface = Color(prefs.getInt("darkSurface", 0)),
        )
    }

    private fun Color.toArgb(): Int {
        val a = (alpha * 255).toInt()
        val r = (red * 255).toInt()
        val g = (green * 255).toInt()
        val b = (blue * 255).toInt()
        return (a shl 24) or (r shl 16) or (g shl 8) or b
    }
}
