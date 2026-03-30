package com.alpacaplayhouse.app.ui.screens

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import coil3.compose.rememberAsyncImagePainter
import com.alpacaplayhouse.app.data.ApiConfig
import com.alpacaplayhouse.app.data.AuthManager

@Composable
fun LoginScreen() {
    val context = LocalContext.current
    val isDark = isSystemInDarkTheme()
    val logoUrl = if (isDark) ApiConfig.LOGO_DARK_URL else ApiConfig.LOGO_LIGHT_URL
    val wordmarkUrl = if (isDark) ApiConfig.WORDMARK_DARK_URL else ApiConfig.WORDMARK_LIGHT_URL

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            // Logo
            Image(
                painter = rememberAsyncImagePainter(logoUrl),
                contentDescription = "Alpaca Playhouse",
                modifier = Modifier
                    .size(96.dp)
                    .clip(RoundedCornerShape(16.dp)),
                contentScale = ContentScale.Fit,
            )

            Spacer(modifier = Modifier.height(16.dp))

            // Wordmark
            Image(
                painter = rememberAsyncImagePainter(wordmarkUrl),
                contentDescription = "Alpaca Playhouse",
                modifier = Modifier
                    .height(32.dp)
                    .widthIn(max = 200.dp),
                contentScale = ContentScale.Fit,
            )

            Spacer(modifier = Modifier.height(48.dp))

            // Welcome text
            Text(
                text = "Welcome",
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onBackground,
            )

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = "Sign in to control your smart home,\nmanage work, and more.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )

            Spacer(modifier = Modifier.height(32.dp))

            // Google sign-in button
            Button(
                onClick = {
                    val url = AuthManager.getGoogleOAuthUrl()
                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                ),
            ) {
                Text(
                    text = "Sign in with Google",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Medium,
                )
            }

            Spacer(modifier = Modifier.height(48.dp))

            // Footer
            Text(
                text = "Alpaca Playhouse Austin",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
            )
        }
    }
}
