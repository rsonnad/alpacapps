package com.alpacaplayhouse.app

import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.lifecycleScope
import com.alpacaplayhouse.app.data.AuthManager
import com.alpacaplayhouse.app.data.BrandConfig
import com.alpacaplayhouse.app.navigation.AppNavigation
import com.alpacaplayhouse.app.ui.screens.LoginScreen
import com.alpacaplayhouse.app.ui.theme.AlpacaPlayhouseTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private var isLoggedIn by mutableStateOf(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        AuthManager.init(this)
        BrandConfig.init(this)
        isLoggedIn = AuthManager.isLoggedIn

        // Refresh brand colors from Supabase in background
        lifecycleScope.launch { BrandConfig.refresh(this@MainActivity) }

        // Handle OAuth callback if launched via deep link
        handleAuthIntent(intent)

        setContent {
            AlpacaPlayhouseTheme {
                AppNavigation()
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleAuthIntent(intent)
    }

    private fun handleAuthIntent(intent: Intent?) {
        val uri = intent?.data ?: return
        if (uri.scheme == "com.alpacaplayhouse.app" && uri.host == "auth") {
            lifecycleScope.launch {
                AuthManager.handleOAuthCallback(uri).onSuccess {
                    isLoggedIn = true
                }
            }
        }
    }
}
