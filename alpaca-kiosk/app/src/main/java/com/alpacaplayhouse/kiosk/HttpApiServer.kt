package com.alpacaplayhouse.kiosk

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.ConnectivityManager
import android.net.wifi.WifiManager
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock
import android.provider.Settings
import android.view.WindowManager
import fi.iki.elonen.NanoHTTPD
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class HttpApiServer(
    private val activity: MainActivity,
    port: Int
) : NanoHTTPD(port) {

    private val prefs = KioskPrefs(activity)

    override fun serve(session: IHTTPSession): Response {
        val uri = session.uri ?: return errorResponse(404, "Not found")
        val params = session.parms ?: emptyMap()

        // Auth check (skip for /ping)
        if (uri != "/ping") {
            val pw = params["pw"] ?: ""
            if (pw != prefs.httpPassword) {
                return errorResponse(401, "Unauthorized")
            }
        }

        return try {
            when {
                session.method == Method.GET && uri == "/ping" ->
                    jsonResponse("""{"ok":true}""")

                session.method == Method.GET && uri == "/status" ->
                    handleStatus()

                session.method == Method.GET && uri == "/screenshot" ->
                    handleScreenshot()

                session.method == Method.POST && uri == "/reload" -> {
                    activity.reloadWebView()
                    jsonResponse("""{"ok":true,"action":"reload"}""")
                }

                session.method == Method.POST && uri == "/navigate" -> {
                    val url = params["url"] ?: return errorResponse(400, "Missing url param")
                    activity.navigateTo(url)
                    jsonResponse("""{"ok":true,"action":"navigate","url":"$url"}""")
                }

                session.method == Method.POST && uri == "/screen/on" ->
                    handleScreenOn()

                session.method == Method.POST && uri == "/screen/off" ->
                    handleScreenOff()

                session.method == Method.POST && uri == "/brightness" -> {
                    val level = params["level"]?.toIntOrNull()
                        ?: return errorResponse(400, "Missing or invalid level param (0-255)")
                    handleBrightness(level.coerceIn(0, 255))
                }

                session.method == Method.POST && uri == "/reboot" ->
                    handleReboot()

                session.method == Method.POST && uri == "/js" -> {
                    val body = readBody(session)
                    handleJsExec(body)
                }

                session.method == Method.POST && uri == "/mode/photobooth" -> {
                    activity.runOnUiThread {
                        val intent = Intent(activity, PhotoBoothActivity::class.java)
                        activity.startActivity(intent)
                    }
                    jsonResponse("""{"ok":true,"action":"photobooth"}""")
                }

                else -> errorResponse(404, "Not found: $uri")
            }
        } catch (e: Exception) {
            errorResponse(500, "Error: ${e.message}")
        }
    }

    private fun handleStatus(): Response {
        val bm = activity.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
        val batteryPct = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        val isCharging = bm.isCharging

        val wm = activity.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        val wifiInfo = wm.connectionInfo
        val ssid = wifiInfo?.ssid?.replace("\"", "") ?: "unknown"
        val rssi = wifiInfo?.rssi ?: 0

        val pm = activity.getSystemService(Context.POWER_SERVICE) as PowerManager
        val screenOn = pm.isInteractive

        val uptime = SystemClock.elapsedRealtime() / 1000

        val versionName = try {
            activity.packageManager.getPackageInfo(activity.packageName, 0).versionName
        } catch (e: Exception) {
            "unknown"
        }

        val json = """
        {
            "battery_percent": $batteryPct,
            "is_charging": $isCharging,
            "wifi_ssid": "$ssid",
            "wifi_rssi": $rssi,
            "screen_on": $screenOn,
            "uptime_seconds": $uptime,
            "app_version": "$versionName",
            "android_version": "${Build.VERSION.RELEASE}",
            "device_model": "${Build.MODEL}"
        }
        """.trimIndent()

        return jsonResponse(json)
    }

    private fun handleScreenshot(): Response {
        val latch = CountDownLatch(1)
        var bitmap: Bitmap? = null

        activity.runOnUiThread {
            val view = activity.webView
            view.isDrawingCacheEnabled = true
            view.buildDrawingCache()
            bitmap = Bitmap.createBitmap(view.drawingCache)
            view.isDrawingCacheEnabled = false
            latch.countDown()
        }

        if (!latch.await(5, TimeUnit.SECONDS)) {
            return errorResponse(500, "Screenshot timeout")
        }

        val bmp = bitmap ?: return errorResponse(500, "Failed to capture screenshot")
        val stream = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.JPEG, 85, stream)
        bmp.recycle()

        val bytes = stream.toByteArray()
        return newFixedLengthResponse(
            Response.Status.OK,
            "image/jpeg",
            ByteArrayInputStream(bytes),
            bytes.size.toLong()
        )
    }

    private fun handleScreenOn(): Response {
        val pm = activity.getSystemService(Context.POWER_SERVICE) as PowerManager
        val wl = pm.newWakeLock(
            PowerManager.FULL_WAKE_LOCK or
                PowerManager.ACQUIRE_CAUSES_WAKEUP or
                PowerManager.ON_AFTER_RELEASE,
            "AlpacaKiosk::ScreenOn"
        )
        wl.acquire(1000)
        wl.release()
        return jsonResponse("""{"ok":true,"action":"screen_on"}""")
    }

    private fun handleScreenOff(): Response {
        val dpm = activity.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val adminComponent = ComponentName(activity, DeviceAdmin::class.java)
        if (dpm.isAdminActive(adminComponent)) {
            dpm.lockNow()
            return jsonResponse("""{"ok":true,"action":"screen_off"}""")
        }
        return errorResponse(403, "Device admin not active — cannot lock screen")
    }

    private fun handleBrightness(level: Int): Response {
        activity.runOnUiThread {
            val lp = activity.window.attributes
            lp.screenBrightness = level / 255f
            activity.window.attributes = lp
        }
        return jsonResponse("""{"ok":true,"action":"brightness","level":$level}""")
    }

    private fun handleReboot(): Response {
        val dpm = activity.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        if (dpm.isDeviceOwnerApp(activity.packageName)) {
            dpm.reboot(ComponentName(activity, DeviceAdmin::class.java))
            return jsonResponse("""{"ok":true,"action":"reboot"}""")
        }
        return errorResponse(403, "Not device owner — cannot reboot")
    }

    private fun handleJsExec(js: String): Response {
        val latch = CountDownLatch(1)
        var result = "null"

        activity.executeJavaScript(js) {
            result = it
            latch.countDown()
        }

        if (!latch.await(10, TimeUnit.SECONDS)) {
            return errorResponse(500, "JS execution timeout")
        }

        return jsonResponse("""{"ok":true,"result":$result}""")
    }

    private fun readBody(session: IHTTPSession): String {
        val contentLength = session.headers["content-length"]?.toIntOrNull() ?: 0
        if (contentLength == 0) return ""
        val buf = ByteArray(contentLength)
        session.inputStream.read(buf, 0, contentLength)
        return String(buf)
    }

    private fun jsonResponse(json: String): Response {
        return newFixedLengthResponse(Response.Status.OK, "application/json", json)
    }

    private fun errorResponse(code: Int, message: String): Response {
        val status = when (code) {
            400 -> Response.Status.BAD_REQUEST
            401 -> Response.Status.UNAUTHORIZED
            403 -> Response.Status.FORBIDDEN
            404 -> Response.Status.NOT_FOUND
            else -> Response.Status.INTERNAL_ERROR
        }
        return newFixedLengthResponse(status, "application/json", """{"error":"$message"}""")
    }
}
