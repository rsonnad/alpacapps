package com.alpacaplayhouse.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.ui.graphics.Color

// Brand colors
val AlpacaDark = Color(0xFF2E2226)
val AlpacaLight = Color(0xFFF5F4ED)
val AlpacaGreen = Color(0xFF2D5016)

private val DarkColorScheme = darkColorScheme(
    primary = AlpacaGreen,
    onPrimary = AlpacaLight,
    secondary = AlpacaGreen,
    background = AlpacaDark,
    onBackground = AlpacaLight,
    surface = Color(0xFF3A2E33),
    onSurface = AlpacaLight,
    surfaceVariant = Color(0xFF4A3E43),
    onSurfaceVariant = Color(0xFFD0C9C4),
    primaryContainer = AlpacaGreen,
    onPrimaryContainer = AlpacaLight,
)

private val LightColorScheme = lightColorScheme(
    primary = AlpacaGreen,
    onPrimary = AlpacaLight,
    secondary = AlpacaGreen,
    background = AlpacaLight,
    onBackground = AlpacaDark,
    surface = Color(0xFFFFFFFF),
    onSurface = AlpacaDark,
    surfaceVariant = Color(0xFFE8E6DF),
    onSurfaceVariant = Color(0xFF4A4A4A),
    primaryContainer = Color(0xFF4A7A2E),
    onPrimaryContainer = AlpacaLight,
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
