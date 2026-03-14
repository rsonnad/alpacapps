package com.alpacaplayhouse.kiosk

import android.Manifest
import android.animation.AnimatorSet
import android.animation.ObjectAnimator
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.os.Bundle
import android.os.CountDownTimer
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import java.io.ByteArrayOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class PhotoBoothActivity : AppCompatActivity() {

    private lateinit var previewView: PreviewView
    private lateinit var countdownText: TextView
    private lateinit var flashOverlay: View
    private lateinit var previewImage: ImageView
    private lateinit var previewControls: FrameLayout
    private lateinit var captureBtn: Button
    private lateinit var retakeBtn: Button
    private lateinit var saveBtn: Button
    private lateinit var closeBtn: Button

    private var imageCapture: ImageCapture? = null
    private lateinit var cameraExecutor: ExecutorService
    private var capturedBitmap: Bitmap? = null
    private var guestBookManager: GuestBookManager? = null

    companion object {
        private const val CAMERA_PERMISSION_CODE = 100
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_photo_booth)

        setupFullscreen()

        previewView = findViewById(R.id.previewView)
        countdownText = findViewById(R.id.countdownText)
        flashOverlay = findViewById(R.id.flashOverlay)
        previewImage = findViewById(R.id.previewImage)
        previewControls = findViewById(R.id.previewControls)
        captureBtn = findViewById(R.id.captureBtn)
        retakeBtn = findViewById(R.id.retakeBtn)
        saveBtn = findViewById(R.id.saveBtn)
        closeBtn = findViewById(R.id.closeBtn)

        cameraExecutor = Executors.newSingleThreadExecutor()

        val prefs = KioskPrefs(this)
        if (prefs.supabaseUrl.isNotBlank() && prefs.supabaseKey.isNotBlank()) {
            guestBookManager = GuestBookManager(prefs.supabaseUrl, prefs.supabaseKey)
        }

        captureBtn.setOnClickListener { startCountdown() }
        retakeBtn.setOnClickListener { resetToCamera() }
        saveBtn.setOnClickListener { savePhoto() }
        closeBtn.setOnClickListener { finish() }

        if (hasCameraPermission()) {
            startCamera()
        } else {
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.CAMERA),
                CAMERA_PERMISSION_CODE
            )
        }
    }

    private fun setupFullscreen() {
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
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
                )
        }
    }

    private fun hasCameraPermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            this, Manifest.permission.CAMERA
        ) == PackageManager.PERMISSION_GRANTED
    }

    override fun onRequestPermissionsResult(
        requestCode: Int, permissions: Array<String>, grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == CAMERA_PERMISSION_CODE) {
            if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                startCamera()
            } else {
                Toast.makeText(this, "Camera permission required for Photo Booth", Toast.LENGTH_LONG).show()
                finish()
            }
        }
    }

    private fun startCamera() {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(this)
        cameraProviderFuture.addListener({
            val cameraProvider = cameraProviderFuture.get()

            val preview = Preview.Builder().build().also {
                it.surfaceProvider = previewView.surfaceProvider
            }

            imageCapture = ImageCapture.Builder()
                .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                .build()

            val cameraSelector = CameraSelector.DEFAULT_FRONT_CAMERA

            try {
                cameraProvider.unbindAll()
                cameraProvider.bindToLifecycle(this, cameraSelector, preview, imageCapture)
            } catch (e: Exception) {
                Toast.makeText(this, "Failed to start camera: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun startCountdown() {
        captureBtn.visibility = View.GONE
        closeBtn.visibility = View.GONE
        countdownText.visibility = View.VISIBLE

        object : CountDownTimer(3000, 1000) {
            override fun onTick(millisUntilFinished: Long) {
                val seconds = (millisUntilFinished / 1000) + 1
                countdownText.text = seconds.toString()

                // Pulse animation
                countdownText.scaleX = 1.5f
                countdownText.scaleY = 1.5f
                countdownText.animate()
                    .scaleX(1f)
                    .scaleY(1f)
                    .setDuration(800)
                    .start()
            }

            override fun onFinish() {
                countdownText.visibility = View.GONE
                takePhoto()
            }
        }.start()
    }

    private fun takePhoto() {
        val capture = imageCapture ?: return

        // Flash effect
        flashOverlay.visibility = View.VISIBLE
        flashOverlay.alpha = 1f
        flashOverlay.animate()
            .alpha(0f)
            .setDuration(300)
            .withEndAction { flashOverlay.visibility = View.GONE }
            .start()

        // Play shutter sound
        val sound = android.media.MediaActionSound()
        sound.play(android.media.MediaActionSound.SHUTTER_CLICK)

        capture.takePicture(cameraExecutor, object : ImageCapture.OnImageCapturedCallback() {
            override fun onCaptureSuccess(image: ImageProxy) {
                val buffer = image.planes[0].buffer
                val bytes = ByteArray(buffer.remaining())
                buffer.get(bytes)

                var bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)

                // Mirror the front camera image
                val matrix = Matrix().apply { preScale(-1f, 1f) }
                bitmap = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)

                // Rotate if needed
                val rotationDegrees = image.imageInfo.rotationDegrees
                if (rotationDegrees != 0) {
                    val rotMatrix = Matrix().apply { postRotate(rotationDegrees.toFloat()) }
                    bitmap = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, rotMatrix, true)
                }

                image.close()

                capturedBitmap = bitmap

                runOnUiThread { showPreview(bitmap) }
            }

            override fun onError(exception: ImageCaptureException) {
                runOnUiThread {
                    Toast.makeText(
                        this@PhotoBoothActivity,
                        "Capture failed: ${exception.message}",
                        Toast.LENGTH_SHORT
                    ).show()
                    resetToCamera()
                }
            }
        })
    }

    private fun showPreview(bitmap: Bitmap) {
        previewView.visibility = View.GONE
        previewImage.visibility = View.VISIBLE
        previewImage.setImageBitmap(bitmap)
        previewControls.visibility = View.VISIBLE
    }

    private fun resetToCamera() {
        capturedBitmap?.recycle()
        capturedBitmap = null
        previewImage.visibility = View.GONE
        previewControls.visibility = View.GONE
        previewView.visibility = View.VISIBLE
        captureBtn.visibility = View.VISIBLE
        closeBtn.visibility = View.VISIBLE
    }

    private fun savePhoto() {
        val bitmap = capturedBitmap ?: return
        saveBtn.isEnabled = false
        saveBtn.text = "Saving..."

        val stream = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, 90, stream)
        val jpegBytes = stream.toByteArray()

        val dateFormat = SimpleDateFormat("yyyy-MM-dd_HHmmss", Locale.US)
        val fileName = "guestbook/${dateFormat.format(Date())}.jpg"

        val manager = guestBookManager
        if (manager != null) {
            Thread {
                try {
                    manager.uploadPhoto(jpegBytes, fileName)
                    manager.insertEntry(fileName)
                    runOnUiThread {
                        Toast.makeText(this, "Photo saved to guest book!", Toast.LENGTH_SHORT).show()
                        Handler(Looper.getMainLooper()).postDelayed({ resetToCamera() }, 1500)
                    }
                } catch (e: Exception) {
                    runOnUiThread {
                        Toast.makeText(this, "Save failed: ${e.message}", Toast.LENGTH_SHORT).show()
                        saveBtn.isEnabled = true
                        saveBtn.text = "Save"
                    }
                }
            }.start()
        } else {
            Toast.makeText(this, "Supabase not configured — photo not uploaded", Toast.LENGTH_LONG).show()
            saveBtn.isEnabled = true
            saveBtn.text = "Save"
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        cameraExecutor.shutdown()
        capturedBitmap?.recycle()
    }
}
