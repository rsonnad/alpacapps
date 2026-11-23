// Issue reporting kit: Android core (storage, identity, screenshots, upload queue).
// Derived from Bridgit's in-app "Report a bug / Request a feature" flow. MIT licence.
//
// Dependencies (app/build.gradle.kts):
//   implementation("androidx.work:work-runtime-ktx:2.9.1")
// Manifest: <uses-permission android:name="android.permission.INTERNET" />
//
// The flow: the form saves the issue on the device first (so nothing is lost offline),
// then a WorkManager job uploads it with exponential backoff. The server is idempotent on
// (install id, client_issue_id), so a retry after a lost response never files it twice.
package com.example.issues

import android.app.Activity
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.view.PixelCopy
import android.view.WindowManager
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume

/** Change these for your app. */
object IssueConfig {
    const val BASE_URL = "https://issue-reports.YOUR-SUBDOMAIN.workers.dev"
    const val MAX_IMAGES = 5
    const val MAX_IMAGE_BYTES = 1_000_000
    const val MAX_IMAGE_EDGE = 1600
    const val MAX_DESCRIPTION = 10_000
    const val PER_KIND_PER_HOUR = 10 // the form's own limit, below the server's
    const val LOG_ENTRIES = 50
}

enum class IssueKind(val id: String) { BUG("bug"), FEATURE("feature") }

enum class UploadState { PENDING, SENT, FAILED }

data class Issue(
    val id: Long,                 // local id; sent as client_issue_id
    val kind: IssueKind,
    val description: String,
    val createdAt: Long,
    val context: JSONObject,
    val log: JSONArray,
    val imageCount: Int,
    val upload: UploadState = UploadState.PENDING,
    val remoteId: Long? = null,   // the server's id once sent
    val uploadError: String? = null,
    val status: String = "new",   // the team's status, pulled from /v1/issues/updates
    val teamNote: String? = null,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("id", id).put("kind", kind.id).put("description", description).put("created_at", createdAt)
        .put("context", context).put("log", log).put("image_count", imageCount).put("upload", upload.name)
        .put("remote_id", remoteId ?: JSONObject.NULL).put("upload_error", uploadError ?: JSONObject.NULL)
        .put("status", status).put("team_note", teamNote ?: JSONObject.NULL)

    companion object {
        fun fromJson(o: JSONObject) = Issue(
            id = o.getLong("id"),
            kind = if (o.getString("kind") == "feature") IssueKind.FEATURE else IssueKind.BUG,
            description = o.getString("description"),
            createdAt = o.getLong("created_at"),
            context = o.optJSONObject("context") ?: JSONObject(),
            log = o.optJSONArray("log") ?: JSONArray(),
            imageCount = o.optInt("image_count"),
            upload = runCatching { UploadState.valueOf(o.getString("upload")) }.getOrDefault(UploadState.PENDING),
            remoteId = if (o.isNull("remote_id")) null else o.getLong("remote_id"),
            uploadError = if (o.isNull("upload_error")) null else o.getString("upload_error"),
            status = o.optString("status", "new"),
            teamNote = if (o.isNull("team_note")) null else o.getString("team_note"),
        )
    }
}

class RateLimited : Exception("Too many reports this hour")

/** One folder per issue under filesDir/issues/<id>/: issue.json plus img-1.jpg … img-5.jpg. */
class IssueStore(private val context: Context) {
    private val root = File(context.filesDir, "issues").apply { mkdirs() }
    private val lock = Any()

    fun all(): List<Issue> = synchronized(lock) {
        root.listFiles().orEmpty().mapNotNull { dir ->
            runCatching { Issue.fromJson(JSONObject(File(dir, "issue.json").readText())) }.getOrNull()
        }.sortedByDescending { it.createdAt }
    }

    fun get(id: Long): Issue? = synchronized(lock) {
        runCatching { Issue.fromJson(JSONObject(File(root, "$id/issue.json").readText())) }.getOrNull()
    }

    fun images(id: Long): List<ByteArray> =
        (1..IssueConfig.MAX_IMAGES).mapNotNull { File(root, "$id/img-$it.jpg").takeIf(File::exists)?.readBytes() }

    /** Saves a new issue and queues its upload. Throws [RateLimited]. */
    fun create(kind: IssueKind, description: String, images: List<ByteArray>, log: JSONArray, ctx: JSONObject): Issue {
        val now = System.currentTimeMillis()
        synchronized(lock) {
            val lastHour = all().count { it.kind == kind && it.createdAt > now - 3_600_000 }
            if (lastHour >= IssueConfig.PER_KIND_PER_HOUR) throw RateLimited()
        }
        // A random positive 53-bit id: unique per install without a counter, and safe as a JSON number.
        val id = (SecureRandom().nextLong() ushr 11).coerceAtLeast(1)
        val dir = File(root, "$id").apply { mkdirs() }
        images.take(IssueConfig.MAX_IMAGES).forEachIndexed { i, b -> File(dir, "img-${i + 1}.jpg").writeBytes(b) }
        val issue = Issue(id, kind, description.trim().take(IssueConfig.MAX_DESCRIPTION), now, ctx, log, images.size.coerceAtMost(IssueConfig.MAX_IMAGES))
        save(issue)
        IssueUploadWorker.enqueue(context)
        return issue
    }

    fun save(issue: Issue) = synchronized(lock) {
        val dir = File(root, "${issue.id}").apply { mkdirs() }
        val tmp = File(dir, "issue.json.tmp")
        tmp.writeText(issue.toJson().toString())
        tmp.renameTo(File(dir, "issue.json")) // atomic on the same filesystem
    }

    fun update(id: Long, change: (Issue) -> Issue) = synchronized(lock) { get(id)?.let { save(change(it)) } }
}

/** The install's identity: a UUID and a random key, made once. The server trusts the first key it sees. */
object InstallIdentity {
    private const val PREFS = "issue_install"

    fun headers(context: Context): Map<String, String> {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        var id = p.getString("id", null)
        var key = p.getString("key", null)
        if (id == null || key == null) {
            id = UUID.randomUUID().toString()
            val bytes = ByteArray(32).also { SecureRandom().nextBytes(it) }
            key = Base64.encodeToString(bytes, Base64.NO_WRAP or Base64.URL_SAFE or Base64.NO_PADDING)
            p.edit().putString("id", id).putString("key", key).commit()
        }
        // For stronger identity, keep the key in EncryptedSharedPreferences or sign each request
        // with an Android Keystore key (what Bridgit does); the server side is described on the page.
        return mapOf("X-Install-Id" to id, "Authorization" to "Bearer $key")
    }
}

/** What goes with every report automatically. Add your own fields; never put secrets or personal data here. */
object IssueContext {
    fun build(context: Context, screen: String?): JSONObject {
        val pm = context.packageManager
        val info = runCatching { pm.getPackageInfo(context.packageName, 0) }.getOrNull()
        return JSONObject()
            .put("app_version", info?.versionName ?: "?")
            .put("version_code", if (Build.VERSION.SDK_INT >= 28) info?.longVersionCode else @Suppress("DEPRECATION") info?.versionCode?.toLong())
            .put("build_type", if (context.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0) "debug" else "release")
            .put("device_model", "${Build.MANUFACTURER} ${Build.MODEL}")
            .put("os_name", "android")
            .put("os_version", Build.VERSION.RELEASE)
            .put("api_level", Build.VERSION.SDK_INT)
            .put("locale", context.resources.configuration.locales[0].toLanguageTag())
            .put("screen", screen ?: JSONObject.NULL)
    }
}

/** A tiny in-memory ring buffer of recent app events. Call RecentLog.add(...) where you already log. Redact before adding. */
object RecentLog {
    private val entries = ArrayDeque<JSONObject>()

    @Synchronized fun add(level: String, tag: String, msg: String) {
        entries.addLast(JSONObject().put("at", System.currentTimeMillis()).put("level", level).put("tag", tag).put("msg", msg.take(500)))
        while (entries.size > IssueConfig.LOG_ENTRIES) entries.removeFirst()
    }

    @Synchronized fun snapshot(): JSONArray = JSONArray(entries.toList())
}

/** Screenshots: grab the screen the user was on, and shrink any picture to <= 1600 px and <= 1 MB JPEG. */
object Screenshots {
    /** Call this BEFORE opening the form, so the form itself isn't in the picture. Returns null for secure windows. */
    suspend fun captureLastScreen(activity: Activity): Bitmap? {
        val window = activity.window
        if (window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0) return null
        val view = window.decorView
        if (view.width == 0 || view.height == 0) return null
        val bmp = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
        if (Build.VERSION.SDK_INT >= 26) {
            val ok = suspendCancellableCoroutine { cont ->
                PixelCopy.request(window, bmp, { result -> cont.resume(result == PixelCopy.SUCCESS) }, Handler(Looper.getMainLooper()))
            }
            if (ok) return bmp
        }
        // Fallback: draw the view hierarchy (misses SurfaceViews such as video or maps).
        return runCatching { bmp.also { view.draw(Canvas(it)) } }.getOrNull()
    }

    fun downscale(src: Bitmap): ByteArray {
        val scale = minOf(1f, IssueConfig.MAX_IMAGE_EDGE.toFloat() / maxOf(src.width, src.height))
        var bmp = if (scale < 1f) Bitmap.createScaledBitmap(src, (src.width * scale).toInt(), (src.height * scale).toInt(), true) else src
        var quality = 85
        while (true) {
            val out = ByteArrayOutputStream()
            bmp.compress(Bitmap.CompressFormat.JPEG, quality, out)
            if (out.size() <= IssueConfig.MAX_IMAGE_BYTES) return out.toByteArray()
            if (quality > 50) quality -= 10
            else bmp = Bitmap.createScaledBitmap(bmp, (bmp.width * 0.8f).toInt(), (bmp.height * 0.8f).toInt(), true)
        }
    }

    fun downscale(bytes: ByteArray): ByteArray? = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.let(::downscale)
}

/** Sends pending issues. Unique job, needs a network, backs off from 30 s. */
class IssueUploadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val store = IssueStore(applicationContext)
        var retry = false
        for (issue in store.all().filter { it.upload != UploadState.SENT && it.uploadError?.startsWith("refused") != true }) {
            when (IssueApi.send(applicationContext, issue, store.images(issue.id))) {
                is IssueApi.Sent -> Unit
                is IssueApi.Retry -> retry = true
                is IssueApi.Refused -> Unit
            }
        }
        if (retry) Result.retry() else Result.success()
    }

    companion object {
        fun enqueue(context: Context) {
            val req = OneTimeWorkRequestBuilder<IssueUploadWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork("issue-upload", ExistingWorkPolicy.APPEND_OR_REPLACE, req)
        }
    }
}

/** The two app-side calls. Plain HttpURLConnection, so there is no HTTP library to add. */
object IssueApi {
    sealed interface Outcome
    data class Sent(val remoteId: Long) : Outcome
    data class Retry(val why: String) : Outcome
    data class Refused(val why: String) : Outcome

    fun payload(issue: Issue, images: List<ByteArray>): JSONObject = JSONObject()
        .put("client_issue_id", issue.id)
        .put("kind", issue.kind.id)
        .put("description", issue.description)
        .put("created_at", issue.createdAt)
        .put("context", issue.context)
        .put("log", issue.log)
        .put("images", JSONArray(images.map { JSONObject().put("mime", "image/jpeg").put("data_base64", Base64.encodeToString(it, Base64.NO_WRAP)) }))

    fun send(context: Context, issue: Issue, images: List<ByteArray>): Outcome {
        val store = IssueStore(context)
        val body = payload(issue, images).toString().toByteArray()
        return try {
            val (code, text) = request(context, "POST", "/v1/issues", body)
            when {
                code == 200 || code == 201 -> {
                    val remote = JSONObject(text).getLong("id")
                    store.update(issue.id) { it.copy(upload = UploadState.SENT, remoteId = remote, uploadError = null) }
                    Sent(remote)
                }
                code == 429 || code >= 500 -> {
                    store.update(issue.id) { it.copy(upload = UploadState.FAILED, uploadError = "HTTP $code") }
                    Retry("HTTP $code")
                }
                else -> { // 400/401/403/413: sending it again won't help
                    store.update(issue.id) { it.copy(upload = UploadState.FAILED, uploadError = "refused: HTTP $code ${errorCode(text)}") }
                    Refused("HTTP $code")
                }
            }
        } catch (e: IOException) {
            store.update(issue.id) { it.copy(upload = UploadState.FAILED, uploadError = e.javaClass.simpleName) }
            Retry(e.javaClass.simpleName)
        }
    }

    /** Pulls what the team changed (status, note) since the saved cursor. Call on app start / when "My reports" opens. */
    fun pullUpdates(context: Context) {
        val prefs = context.getSharedPreferences("issue_install", Context.MODE_PRIVATE)
        val store = IssueStore(context)
        var more = true
        while (more) {
            val since = prefs.getLong("cursor", 0)
            val sinceId = prefs.getLong("cursor_id", -1).takeIf { it >= 0 }
            val (code, text) = runCatching { request(context, "GET", "/v1/issues/updates?since=$since" + (sinceId?.let { "&since_id=$it" } ?: ""), null) }.getOrNull() ?: return
            if (code != 200) return // 401 before the first upload is normal: nothing filed yet
            val o = JSONObject(text)
            val updates = o.getJSONArray("updates")
            val byRemote = store.all().associateBy { it.remoteId }
            for (i in 0 until updates.length()) {
                val u = updates.getJSONObject(i)
                byRemote[u.getLong("id")]?.let { local ->
                    store.update(local.id) { it.copy(status = u.getString("status"), teamNote = if (u.isNull("team_note")) null else u.getString("team_note")) }
                }
            }
            prefs.edit().putLong("cursor", o.getLong("cursor")).apply { if (!o.isNull("cursor_id")) putLong("cursor_id", o.getLong("cursor_id")) }.apply()
            more = o.optBoolean("more")
        }
    }

    private fun request(context: Context, method: String, path: String, body: ByteArray?): Pair<Int, String> {
        val conn = URL(IssueConfig.BASE_URL + path).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = method
            conn.connectTimeout = 15_000
            conn.readTimeout = 60_000
            conn.instanceFollowRedirects = false
            InstallIdentity.headers(context).forEach { (k, v) -> conn.setRequestProperty(k, v) }
            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.setFixedLengthStreamingMode(body.size)
                conn.outputStream.use { it.write(body) }
            }
            val code = conn.responseCode
            val text = (if (code < 400) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
            return code to text
        } finally {
            conn.disconnect()
        }
    }

    private fun errorCode(body: String) = runCatching { JSONObject(body).getString("error") }.getOrDefault("")
}
