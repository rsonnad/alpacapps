package com.alpacaplayhouse.kiosk

import android.content.Context
import android.content.Intent
import android.net.wifi.WifiManager
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.webkit.JavascriptInterface

class JsBridge(private val activity: MainActivity) {

    @JavascriptInterface
    fun openPhotoBooth() {
        activity.runOnUiThread {
            val intent = Intent(activity, PhotoBoothActivity::class.java)
            activity.startActivity(intent)
        }
    }

    @JavascriptInterface
    fun getDeviceInfo(): String {
        val bm = activity.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
        val batteryPct = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        val isCharging = bm.isCharging

        val wm = activity.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        val ssid = wm.connectionInfo?.ssid?.replace("\"", "") ?: "unknown"

        val pm = activity.getSystemService(Context.POWER_SERVICE) as PowerManager
        val screenOn = pm.isInteractive

        val uptime = SystemClock.elapsedRealtime() / 1000

        return """
        {
            "battery_percent": $batteryPct,
            "is_charging": $isCharging,
            "wifi_ssid": "$ssid",
            "screen_on": $screenOn,
            "uptime_seconds": $uptime,
            "device_model": "${Build.MODEL}",
            "android_version": "${Build.VERSION.RELEASE}"
        }
        """.trimIndent()
    }

    @JavascriptInterface
    fun setBrightness(level: Int) {
        activity.runOnUiThread {
            val lp = activity.window.attributes
            lp.screenBrightness = level.coerceIn(0, 255) / 255f
            activity.window.attributes = lp
        }
    }

    @JavascriptInterface
    fun vibrate(durationMs: Long) {
        val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vm = activity.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
            vm.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            activity.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }

        vibrator.vibrate(
            VibrationEffect.createOneShot(durationMs, VibrationEffect.DEFAULT_AMPLITUDE)
        )
    }

    @JavascriptInterface
    fun playSound(name: String) {
        // Play built-in sounds by name
        activity.runOnUiThread {
            val resId = when (name) {
                "shutter" -> android.media.MediaActionSound.SHUTTER_CLICK
                "focus" -> android.media.MediaActionSound.AUTO_FOCUS
                else -> android.media.MediaActionSound.SHUTTER_CLICK
            }
            val sound = android.media.MediaActionSound()
            sound.play(resId)
        }
    }

    @JavascriptInterface
    fun reload() {
        activity.reloadWebView()
    }

    @JavascriptInterface
    fun getAppVersion(): String {
        return try {
            activity.packageManager.getPackageInfo(activity.packageName, 0).versionName ?: "unknown"
        } catch (e: Exception) {
            "unknown"
        }
    }
}
