package com.alpacaplayhouse.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.ui.graphics.Color

// Brand colors — from style guide (Current Teal palette)
val AlpacaPrimary = Color(0xFF3D8B7A)       // Teal
val AlpacaPrimaryLight = Color(0xFF5A9E8F)  // Light teal
val AlpacaAccent = Color(0xFFE07A5F)        // Warm salmon
val AlpacaBackground = Color(0xFFFAF9F7)    // Warm white
val AlpacaText = Color(0xFF2D3142)          // Dark navy
val AlpacaMuted = Color(0xFF7A7D8C)         // Grey-blue

// Dark mode variants
val AlpacaDarkBg = Color(0xFF1A1E2C)        // Deep navy
val AlpacaDarkSurface = Color(0xFF252A3A)   // Lighter navy
val AlpacaDarkSurfaceVar = Color(0xFF2F3447) // Surface variant

private val DarkColorScheme = darkColorScheme(
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

private val LightColorScheme = lightColorScheme(
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
    val colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme

    MaterialTheme(
        colorScheme = colorScheme,
        content = content
    )
}
