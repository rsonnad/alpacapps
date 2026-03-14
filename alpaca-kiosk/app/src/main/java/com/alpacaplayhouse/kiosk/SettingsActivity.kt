package com.alpacaplayhouse.kiosk

import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

class SettingsActivity : AppCompatActivity() {

    private lateinit var prefs: KioskPrefs
    private lateinit var passwordLayout: LinearLayout
    private lateinit var settingsLayout: ScrollView
    private lateinit var passwordInput: EditText
    private var authenticated = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = KioskPrefs(this)

        // Build UI programmatically to avoid extra layout files
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 48, 48, 48)
            setBackgroundColor(0xFF1a1a2e.toInt())
        }

        // Password gate
        passwordLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = android.view.Gravity.CENTER
        }

        val title = TextView(this).apply {
            text = "Kiosk Settings"
            textSize = 24f
            setTextColor(0xFFFFFFFF.toInt())
            setPadding(0, 0, 0, 32)
        }
        passwordLayout.addView(title)

        val pwLabel = TextView(this).apply {
            text = "Enter settings password:"
            textSize = 16f
            setTextColor(0xFFCCCCCC.toInt())
            setPadding(0, 0, 0, 8)
        }
        passwordLayout.addView(pwLabel)

        passwordInput = EditText(this).apply {
            inputType = android.text.InputType.TYPE_CLASS_NUMBER or
                android.text.InputType.TYPE_NUMBER_VARIATION_PASSWORD
            setTextColor(0xFFFFFFFF.toInt())
            setHintTextColor(0xFF888888.toInt())
            hint = "Password"
            setBackgroundColor(0xFF2a2a4e.toInt())
            setPadding(24, 16, 24, 16)
        }
        passwordLayout.addView(passwordInput)

        val unlockBtn = Button(this).apply {
            text = "Unlock"
            setOnClickListener { checkPassword() }
        }
        passwordLayout.addView(unlockBtn)

        root.addView(passwordLayout)

        // Settings form (hidden until authenticated)
        settingsLayout = ScrollView(this).apply {
            visibility = View.GONE
        }

        val settingsContent = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }

        val settingsTitle = TextView(this).apply {
            text = "Kiosk Settings"
            textSize = 24f
            setTextColor(0xFFFFFFFF.toInt())
            setPadding(0, 0, 0, 32)
        }
        settingsContent.addView(settingsTitle)

        // Start URL
        val urlInput = addSettingField(settingsContent, "Start URL", prefs.startUrl)
        // HTTP Port
        val portInput = addSettingField(settingsContent, "HTTP API Port", prefs.httpPort.toString())
        // HTTP Password
        val httpPwInput = addSettingField(settingsContent, "HTTP API Password", prefs.httpPassword)
        // Settings Password
        val settingsPwInput = addSettingField(settingsContent, "Settings Password", prefs.settingsPassword)
        // Screen Timeout
        val timeoutInput = addSettingField(settingsContent, "Screen Timeout (min, 0=off)", prefs.screenTimeout.toString())
        // Auto Restart
        val restartInput = addSettingField(settingsContent, "Auto-Restart (hours, 0=off)", prefs.autoRestartHours.toString())
        // Wake on Motion
        val wakeCheck = CheckBox(this).apply {
            text = "Wake on proximity sensor"
            setTextColor(0xFFCCCCCC.toInt())
            isChecked = prefs.wakeOnMotion
            setPadding(0, 16, 0, 16)
        }
        settingsContent.addView(wakeCheck)

        // Supabase URL
        val supabaseUrlInput = addSettingField(settingsContent, "Supabase URL (for guest book)", prefs.supabaseUrl)
        // Supabase Key
        val supabaseKeyInput = addSettingField(settingsContent, "Supabase Anon Key", prefs.supabaseKey)

        // Save button
        val saveBtn = Button(this).apply {
            text = "Save Settings"
            setOnClickListener {
                prefs.startUrl = urlInput.text.toString().ifBlank { "https://alpacaplayhouse.com/kioskhall/" }
                prefs.httpPort = portInput.text.toString().toIntOrNull() ?: 2323
                prefs.httpPassword = httpPwInput.text.toString().ifBlank { "alpaca2323" }
                prefs.settingsPassword = settingsPwInput.text.toString().ifBlank { "1234" }
                prefs.screenTimeout = timeoutInput.text.toString().toIntOrNull() ?: 0
                prefs.autoRestartHours = restartInput.text.toString().toIntOrNull() ?: 0
                prefs.wakeOnMotion = wakeCheck.isChecked
                prefs.supabaseUrl = supabaseUrlInput.text.toString()
                prefs.supabaseKey = supabaseKeyInput.text.toString()

                Toast.makeText(this@SettingsActivity, "Settings saved", Toast.LENGTH_SHORT).show()

                // Restart HTTP server with new port
                (application as? android.app.Application)?.let {
                    // Will be picked up on next activity resume
                }
            }
        }
        settingsContent.addView(saveBtn)

        // Exit kiosk button
        val exitBtn = Button(this).apply {
            text = "Exit Kiosk Mode"
            setBackgroundColor(0xFF8B0000.toInt())
            setTextColor(0xFFFFFFFF.toInt())
            setPadding(24, 16, 24, 16)
            val lp = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
            lp.topMargin = 32
            layoutParams = lp
            setOnClickListener {
                AlertDialog.Builder(this@SettingsActivity)
                    .setTitle("Exit Kiosk Mode?")
                    .setMessage("This will return the tablet to normal Android mode.")
                    .setPositiveButton("Exit") { _, _ ->
                        val mainActivity = MainActivity::class.java
                        // Find the running MainActivity and call exitKioskMode
                        val intent = android.content.Intent("com.alpacaplayhouse.kiosk.EXIT_KIOSK")
                        sendBroadcast(intent)
                        finish()
                    }
                    .setNegativeButton("Cancel", null)
                    .show()
            }
        }
        settingsContent.addView(exitBtn)

        // Back button
        val backBtn = Button(this).apply {
            text = "Back to Kiosk"
            val lp = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
            lp.topMargin = 16
            layoutParams = lp
            setOnClickListener { finish() }
        }
        settingsContent.addView(backBtn)

        settingsLayout.addView(settingsContent)
        root.addView(settingsLayout)

        setContentView(root)
    }

    private fun addSettingField(parent: LinearLayout, label: String, value: String): EditText {
        val lbl = TextView(this).apply {
            text = label
            textSize = 14f
            setTextColor(0xFFCCCCCC.toInt())
            setPadding(0, 16, 0, 4)
        }
        parent.addView(lbl)

        val input = EditText(this).apply {
            setText(value)
            setTextColor(0xFFFFFFFF.toInt())
            setHintTextColor(0xFF888888.toInt())
            setBackgroundColor(0xFF2a2a4e.toInt())
            setPadding(24, 16, 24, 16)
            isSingleLine = true
        }
        parent.addView(input)

        return input
    }

    private fun checkPassword() {
        val entered = passwordInput.text.toString()
        if (entered == prefs.settingsPassword) {
            authenticated = true
            passwordLayout.visibility = View.GONE
            settingsLayout.visibility = View.VISIBLE
        } else {
            Toast.makeText(this, "Incorrect password", Toast.LENGTH_SHORT).show()
            passwordInput.text.clear()
        }
    }
}
