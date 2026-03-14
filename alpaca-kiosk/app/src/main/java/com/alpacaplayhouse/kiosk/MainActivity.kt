package com.alpacaplayhouse.kiosk

import android.app.ActivityManager
import android.app.admin.DevicePolicyManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    lateinit var webView: WebView
        private set
    private lateinit var offlineView: FrameLayout
    private lateinit var prefs: KioskPrefs
    private var httpServer: HttpApiServer? = null
    private var cornerTapCount = 0
    private var lastCornerTapTime = 0L
    private val handler = Handler(Looper.getMainLooper())
    private var screenTimeoutRunnable: Runnable? = null
    private var autoRestartRunnable: Runnable? = null
    private lateinit var wakeLock: PowerManager.WakeLock

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            runOnUiThread {
                offlineView.visibility = View.GONE
                webView.visibility = View.VISIBLE
                webView.reload()
            }
        }

        override fun onLost(network: Network) {
            runOnUiThread {
                if (!isNetworkAvailable()) {
                    webView.visibility = View.GONE
                    offlineView.visibility = View.VISIBLE
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        prefs = KioskPrefs(this)
        webView = findViewById(R.id.webView)
        offlineView = findViewById(R.id.offlineView)

        setupFullscreen()
        setupWebView()
        setupKioskMode()
        startHttpServer()
        registerNetworkCallback()
        setupScreenTimeout()
        setupAutoRestart()
        setupCrashHandler()

        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "AlpacaKiosk::HttpServer"
        )
        wakeLock.acquire()

        if (isNetworkAvailable()) {
            webView.loadUrl(prefs.startUrl)
        } else {
            webView.visibility = View.GONE
            offlineView.visibility = View.VISIBLE
        }
    }

    private fun setupFullscreen() {
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.let {
                it.hide(WindowInsets.Type.systemBars())
                it.systemBarsBehavior =
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                )
        }
    }

    private fun setupWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
            useWideViewPort = true
            loadWithOverviewMode = true
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            allowFileAccess = true
        }

        webView.webViewClient = KioskWebViewClient(this)
        webView.addJavascriptInterface(JsBridge(this), "AlpacaKiosk")
    }

    private fun setupKioskMode() {
        val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val adminComponent = ComponentName(this, DeviceAdmin::class.java)

        if (dpm.isDeviceOwnerApp(packageName)) {
            // Set this activity as the lock task package
            dpm.setLockTaskPackages(adminComponent, arrayOf(packageName))
            startLockTask()
        }
    }

    fun exitKioskMode() {
        val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        if (dpm.isDeviceOwnerApp(packageName)) {
            stopLockTask()
        }
    }

    private fun startHttpServer() {
        httpServer?.stop()
        httpServer = HttpApiServer(this, prefs.httpPort).also {
            it.start()
        }
    }

    fun restartHttpServer() {
        startHttpServer()
    }

    private fun registerNetworkCallback() {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        cm.registerNetworkCallback(request, networkCallback)
    }

    private fun isNetworkAvailable(): Boolean {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(network) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private fun setupScreenTimeout() {
        screenTimeoutRunnable?.let { handler.removeCallbacks(it) }
        val timeoutMinutes = prefs.screenTimeout
        if (timeoutMinutes > 0) {
            screenTimeoutRunnable = Runnable {
                val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
                if (pm.isInteractive) {
                    val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
                    val adminComponent = ComponentName(this, DeviceAdmin::class.java)
                    if (dpm.isAdminActive(adminComponent)) {
                        dpm.lockNow()
                    }
                }
            }
            handler.postDelayed(screenTimeoutRunnable!!, timeoutMinutes * 60_000L)
        }
    }

    private fun setupAutoRestart() {
        autoRestartRunnable?.let { handler.removeCallbacks(it) }
        val hours = prefs.autoRestartHours
        if (hours > 0) {
            autoRestartRunnable = Runnable {
                webView.reload()
                setupAutoRestart() // reschedule
            }
            handler.postDelayed(autoRestartRunnable!!, hours * 3_600_000L)
        }
    }

    private fun setupCrashHandler() {
        val defaultHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            // Restart the app on crash
            val intent = packageManager.getLaunchIntentForPackage(packageName)
            intent?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
            startActivity(intent)
            android.os.Process.killProcess(android.os.Process.myPid())
        }
    }

    fun resetScreenTimeout() {
        setupScreenTimeout()
    }

    override fun onTouchEvent(event: MotionEvent?): Boolean {
        resetScreenTimeout()
        event?.let { checkCornerTap(it) }
        return super.onTouchEvent(event)
    }

    override fun dispatchTouchEvent(ev: MotionEvent?): Boolean {
        resetScreenTimeout()
        ev?.let { checkCornerTap(it) }
        return super.dispatchTouchEvent(ev)
    }

    private fun checkCornerTap(event: MotionEvent) {
        if (event.action != MotionEvent.ACTION_DOWN) return

        val displayMetrics = resources.displayMetrics
        val screenWidth = displayMetrics.widthPixels
        val screenHeight = displayMetrics.heightPixels
        val cornerSize = 100 // pixels

        // Bottom-right corner
        val isCorner = event.x > screenWidth - cornerSize && event.y > screenHeight - cornerSize

        if (isCorner) {
            val now = System.currentTimeMillis()
            if (now - lastCornerTapTime > 2000) {
                cornerTapCount = 0
            }
            cornerTapCount++
            lastCornerTapTime = now

            if (cornerTapCount >= 3) {
                cornerTapCount = 0
                openSettings()
            }
        }
    }

    private fun openSettings() {
        val intent = Intent(this, SettingsActivity::class.java)
        startActivity(intent)
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        // Disable back button
        if (keyCode == KeyEvent.KEYCODE_BACK) return true
        if (keyCode == KeyEvent.KEYCODE_HOME) return true
        if (keyCode == KeyEvent.KEYCODE_APP_SWITCH) return true
        return super.onKeyDown(keyCode, event)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) setupFullscreen()
    }

    override fun onResume() {
        super.onResume()
        setupFullscreen()
    }

    override fun onDestroy() {
        httpServer?.stop()
        if (wakeLock.isHeld) wakeLock.release()
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        cm.unregisterNetworkCallback(networkCallback)
        screenTimeoutRunnable?.let { handler.removeCallbacks(it) }
        autoRestartRunnable?.let { handler.removeCallbacks(it) }
        super.onDestroy()
    }

    fun reloadWebView() {
        runOnUiThread { webView.reload() }
    }

    fun navigateTo(url: String) {
        runOnUiThread { webView.loadUrl(url) }
    }

    fun executeJavaScript(js: String, callback: (String) -> Unit) {
        runOnUiThread {
            webView.evaluateJavascript(js) { result ->
                callback(result ?: "null")
            }
        }
    }
}
