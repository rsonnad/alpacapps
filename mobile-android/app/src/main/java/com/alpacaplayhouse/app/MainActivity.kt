package com.alpacaplayhouse.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.alpacaplayhouse.app.navigation.AppNavigation
import com.alpacaplayhouse.app.ui.theme.AlpacaPlayhouseTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            AlpacaPlayhouseTheme {
                AppNavigation()
            }
        }
    }
}
