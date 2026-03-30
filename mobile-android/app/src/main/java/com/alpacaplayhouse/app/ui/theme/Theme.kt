package com.alpacaplayhouse.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import com.alpacaplayhouse.app.data.BrandConfig

// Brand colors — sourced from BrandConfig (dynamically loaded from Supabase)
val AlpacaPrimary: Color get() = BrandConfig.current.primary
val AlpacaPrimaryLight: Color get() = BrandConfig.current.primaryLight
val AlpacaAccent: Color get() = BrandConfig.current.accent
val AlpacaBackground: Color get() = BrandConfig.current.background
val AlpacaText: Color get() = BrandConfig.current.text
val AlpacaMuted: Color get() = BrandConfig.current.muted

// Dark mode variants
val AlpacaDarkBg: Color get() = BrandConfig.current.darkBg
val AlpacaDarkSurface: Color get() = BrandConfig.current.darkSurface
val AlpacaDarkSurfaceVar = Color(0xFF2F3447)

// Alpaca Luxe design tokens
object AlpacaLuxe {
    // Glass card colors
    val glassLight = Color.White.copy(alpha = 0.08f)
    val glassBorder = Color.White.copy(alpha = 0.10f)
    val glassBorderLight = Color.Black.copy(alpha = 0.06f)

    val glassLightMode = Color.White.copy(alpha = 0.85f)
    val glassBorderLightMode = Color.Black.copy(alpha = 0.08f)

    // Glow colors
    val primaryGlow: Color get() = AlpacaPrimary.copy(alpha = 0.25f)
    val accentGlow: Color get() = AlpacaAccent.copy(alpha = 0.30f)

    // Gradient: teal to dark navy (for headers)
    val headerGradientDark: Brush
        get() = Brush.verticalGradient(
            colors = listOf(AlpacaPrimary.copy(alpha = 0.4f), AlpacaDarkBg)
        )
    val headerGradientLight: Brush
        get() = Brush.verticalGradient(
            colors = listOf(AlpacaPrimary.copy(alpha = 0.12f), AlpacaBackground)
        )

    // Nav bar
    val navBarDark: Color get() = AlpacaDarkSurface.copy(alpha = 0.95f)
    val navBarLight = Color.White.copy(alpha = 0.97f)
    val navIndicator: Color get() = AlpacaPrimary.copy(alpha = 0.15f)

    // Card corners
    const val cardRadius = 16
    const val cardRadiusLarge = 20
    const val chipRadius = 12
}

private fun buildDarkColorScheme() = darkColorScheme(
    primary = AlpacaPrimary,
    onPrimary = Color.White,
    secondary = AlpacaPrimaryLight,
    onSecondary = Color.White,
    tertiary = AlpacaAccent,
    background = AlpacaDarkBg,
    onBackground = Color(0xFFE8E6E0),
    surface = AlpacaDarkSurface,
    onSurface = Color(0xFFE8E6E0),
    surfaceVariant = AlpacaDarkSurfaceVar,
    onSurfaceVariant = Color(0xFFB0ADA6),
    primaryContainer = Color(0xFF2A6355),
    onPrimaryContainer = Color(0xFFD0F0E8),
    error = Color(0xFFCF6679),
    onError = Color.Black,
)

private fun buildLightColorScheme() = lightColorScheme(
    primary = AlpacaPrimary,
    onPrimary = Color.White,
    secondary = AlpacaPrimaryLight,
    onSecondary = Color.White,
    tertiary = AlpacaAccent,
    background = AlpacaBackground,
    onBackground = AlpacaText,
    surface = Color.White,
    onSurface = AlpacaText,
    surfaceVariant = Color(0xFFF0EFEA),
    onSurfaceVariant = Color(0xFF545766),
    primaryContainer = Color(0xFFD0F0E8),
    onPrimaryContainer = Color(0xFF1A4A3E),
    error = Color(0xFFB00020),
    onError = Color.White,
)

@Composable
fun AlpacaPlayhouseTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    val colorScheme = if (darkTheme) buildDarkColorScheme() else buildLightColorScheme()

    MaterialTheme(
        colorScheme = colorScheme,
        content = content
    )
}
