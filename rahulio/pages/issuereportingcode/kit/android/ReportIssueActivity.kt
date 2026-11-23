// Issue reporting kit: Android form ("Report a bug" / "Request a feature"), Jetpack Compose + Material 3.
// Bridgit's own form is a View-based Fragment; this is the same design in one Compose file. MIT licence.
//
// Dependencies (app/build.gradle.kts, Compose enabled):
//   implementation(platform("androidx.compose:compose-bom:2024.09.03"))
//   implementation("androidx.activity:activity-compose:1.9.2")
//   implementation("androidx.compose.material3:material3")
//   implementation("androidx.compose.material:material-icons-core")
// Manifest:
//   <activity android:name="com.example.issues.ReportIssueActivity" android:exported="false"
//       android:windowSoftInputMode="adjustResize" />
//
// Open it from a menu item:  lifecycleScope.launch { ReportIssue.open(this@MainActivity, IssueKind.BUG, "Settings") }
package com.example.issues

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

object ReportIssue {
    /** Grabs the current screen first (so the form isn't in it), then opens the form. */
    suspend fun open(activity: Activity, kind: IssueKind, screen: String?) {
        LastScreen.bitmap = Screenshots.captureLastScreen(activity)
        activity.startActivity(
            Intent(activity, ReportIssueActivity::class.java).putExtra("kind", kind.id).putExtra("screen", screen),
        )
    }
}

/** Hands the capture to the form without squeezing a bitmap through an Intent. */
object LastScreen { @Volatile var bitmap: Bitmap? = null }

private object Copy {
    fun title(k: IssueKind) = if (k == IssueKind.BUG) "Report a bug" else "Request a feature"
    fun intro(k: IssueKind) = if (k == IssueKind.BUG) "Describe what went wrong." else "Describe what you’d like."
    fun label(k: IssueKind) = if (k == IssueKind.BUG) "What happened?" else "What would you like to see?"
    fun placeholder(k: IssueKind) = if (k == IssueKind.BUG) "What you expected, what you saw…" else "What would you like the app to do?"
    const val REQUIRED = "Please describe the problem before sending."
    const val AUTO = "App version, device info and the screen you were on are included automatically."
    const val RATE = "That’s 10 reports this hour. Try again later."
    const val SAVE_FAILED = "Couldn’t save the report. Please try again."
    const val SAVED_TITLE = "Report saved"
    const val SAVED_QUEUED = "Thanks. It’s saved on your device and will be sent to the team when you’re online."
    fun savedSent(id: Long) = "Thanks. It’s report #$id, and the team has it."
}

private object Drafts {
    private fun prefs(c: Context) = c.getSharedPreferences("issue_drafts", Context.MODE_PRIVATE)
    fun load(c: Context, k: IssueKind) = prefs(c).getString(k.id, "").orEmpty()
    fun save(c: Context, k: IssueKind, text: String) = prefs(c).edit().putString(k.id, text).apply()
}

class ReportIssueActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val kind = if (intent.getStringExtra("kind") == "feature") IssueKind.FEATURE else IssueKind.BUG
        val screen = intent.getStringExtra("screen")
        val last = LastScreen.bitmap.also { LastScreen.bitmap = null }
        // Wrap in your app's own theme (e.g. AppTheme { … }) so the form matches the rest of the app.
        setContent { MaterialTheme { ReportIssueScreen(kind, screen, last, onDone = { finish() }) } }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReportIssueScreen(initialKind: IssueKind, screen: String?, lastScreen: Bitmap?, onDone: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var kind by rememberSaveable { mutableStateOf(initialKind) }
    var text by rememberSaveable { mutableStateOf(Drafts.load(context, initialKind)) }
    var includeLast by rememberSaveable { mutableStateOf(lastScreen != null) }
    var includeLog by rememberSaveable { mutableStateOf(true) }
    val picked = remember { mutableStateListOf<ByteArray>() }
    var importing by remember { mutableStateOf(false) }
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var fieldError by remember { mutableStateOf(false) }
    var saved by remember { mutableStateOf<Issue?>(null) }
    var askKeep by remember { mutableStateOf(false) }
    var showLog by remember { mutableStateOf(false) }
    val log = remember { RecentLog.snapshot() }
    val maxPicked = IssueConfig.MAX_IMAGES - if (includeLast && lastScreen != null) 1 else 0

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(IssueConfig.MAX_IMAGES)) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        importing = true
        scope.launch {
            val added = withContext(Dispatchers.IO) {
                uris.mapNotNull { uri -> runCatching { context.contentResolver.openInputStream(uri)?.use { it.readBytes() } }.getOrNull()?.let(Screenshots::downscale) }
            }
            if (added.size < uris.size) error = "Couldn’t add one of those pictures. Please try again."
            added.take((maxPicked - picked.size).coerceAtLeast(0)).forEach { picked.add(it) }
            importing = false
        }
    }

    fun switchKind(to: IssueKind) {
        if (to == kind) return
        Drafts.save(context, kind, text) // each kind keeps its own draft
        kind = to
        text = Drafts.load(context, to)
    }

    fun cancel() = if (text.isNotBlank()) askKeep = true else onDone()

    fun submit() {
        if (text.isBlank()) { fieldError = true; error = Copy.REQUIRED; return }
        sending = true; error = null
        scope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    val images = buildList {
                        if (includeLast && lastScreen != null) add(Screenshots.downscale(lastScreen))
                        addAll(picked)
                    }
                    IssueStore(context).create(kind, text, images, if (includeLog) log else org.json.JSONArray(), IssueContext.build(context, screen))
                }
            }
            sending = false
            result.onSuccess { Drafts.save(context, kind, ""); saved = it }
                .onFailure { error = if (it is RateLimited) Copy.RATE else Copy.SAVE_FAILED }
        }
    }

    BackHandler { cancel() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(Copy.title(kind)) },
                navigationIcon = { IconButton(onClick = ::cancel) { Icon(Icons.Filled.Close, contentDescription = "Cancel") } },
                actions = {
                    Button(onClick = ::submit, enabled = text.isNotBlank() && !sending && !importing, modifier = Modifier.padding(end = 8.dp)) {
                        if (sending) {
                            CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                            Spacer(Modifier.width(8.dp)); Text("Sending…")
                        } else Text("Submit")
                    }
                },
            )
        },
    ) { pad ->
        Column(
            Modifier.padding(pad).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            error?.let {
                Surface(color = MaterialTheme.colorScheme.errorContainer, shape = RoundedCornerShape(12.dp)) {
                    Text(it, color = MaterialTheme.colorScheme.onErrorContainer, modifier = Modifier.fillMaxWidth().padding(12.dp))
                }
            }
            Text(Copy.intro(kind), color = MaterialTheme.colorScheme.onSurfaceVariant)

            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                IssueKind.entries.forEachIndexed { i, k ->
                    SegmentedButton(selected = kind == k, onClick = { switchKind(k) }, shape = SegmentedButtonDefaults.itemShape(i, IssueKind.entries.size)) {
                        Text(if (k == IssueKind.BUG) "Bug" else "Feature")
                    }
                }
            }

            Panel {
                Text(Copy.label(kind), style = MaterialTheme.typography.titleSmall)
                OutlinedTextField(
                    value = text,
                    onValueChange = { v -> text = v.take(IssueConfig.MAX_DESCRIPTION); fieldError = false; Drafts.save(context, kind, text) },
                    placeholder = { Text(Copy.placeholder(kind)) },
                    isError = fieldError,
                    minLines = 3,
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            Panel {
                if (lastScreen != null) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Image(lastScreen.asImageBitmap(), "Screenshot of the screen you were on", Modifier.size(32.dp, 48.dp).clip(RoundedCornerShape(4.dp)), contentScale = ContentScale.Crop)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text("Include last screen")
                            Text(screen?.let { "$it, as you left it" } ?: "The screen you were on", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Switch(checked = includeLast, onCheckedChange = { includeLast = it })
                    }
                }
                if (picked.isNotEmpty()) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        picked.forEachIndexed { i, bytes ->
                            val bmp = remember(bytes) { BitmapFactory.decodeByteArray(bytes, 0, bytes.size) }
                            Box {
                                Image(bmp.asImageBitmap(), "Screenshot ${i + 1}", Modifier.size(48.dp, 72.dp).clip(RoundedCornerShape(6.dp)), contentScale = ContentScale.Crop)
                                IconButton(onClick = { picked.removeAt(i) }, Modifier.size(20.dp).align(Alignment.TopEnd)) {
                                    Icon(Icons.Filled.Close, "Remove screenshot ${i + 1}")
                                }
                            }
                        }
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedButton(
                        onClick = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                        enabled = picked.size < maxPicked && !importing,
                    ) { Text(if (picked.isEmpty()) "Add screenshot" else "Add another") }
                    if (importing) { Spacer(Modifier.width(8.dp)); CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp) }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = includeLog, onCheckedChange = { includeLog = it })
                    Column(Modifier.weight(1f)) {
                        Text("Include recent log")
                        Row {
                            Text("${log.length()} log ${if (log.length() == 1) "entry" else "entries"} · ", style = MaterialTheme.typography.bodySmall)
                            Text("Preview", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary,
                                textDecoration = TextDecoration.Underline, modifier = Modifier.clickable { showLog = true })
                        }
                    }
                }
            }
            Text(Copy.AUTO, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }

    if (askKeep) AlertDialog(
        onDismissRequest = { askKeep = false },
        title = { Text("Keep this draft?") },
        confirmButton = { TextButton(onClick = { Drafts.save(context, kind, text); onDone() }) { Text("Keep") } },
        dismissButton = { TextButton(onClick = { Drafts.save(context, kind, ""); onDone() }) { Text("Discard") } },
    )

    if (showLog) AlertDialog(
        onDismissRequest = { showLog = false },
        title = { Text("Recent log") },
        text = {
            Text(
                if (log.length() == 0) "No log entries yet."
                else (0 until log.length()).joinToString("\n") { i -> log.getJSONObject(i).let { "${it.optString("level")} ${it.optString("tag")}: ${it.optString("msg")}" } },
                style = MaterialTheme.typography.bodySmall,
            )
        },
        confirmButton = { TextButton(onClick = { showLog = false }) { Text("Close") } },
    )

    saved?.let { issue ->
        // The upload runs in the background; show the number if it lands within a few seconds.
        var sentId by remember { mutableStateOf<Long?>(null) }
        LaunchedEffect(issue.id) {
            repeat(30) {
                val now = withContext(Dispatchers.IO) { IssueStore(context).get(issue.id) }
                if (now?.remoteId != null) { sentId = now.remoteId; return@LaunchedEffect }
                kotlinx.coroutines.delay(1000)
            }
        }
        AlertDialog(
            onDismissRequest = onDone,
            title = { Text(Copy.SAVED_TITLE) },
            text = { Text(sentId?.let(Copy::savedSent) ?: Copy.SAVED_QUEUED) },
            confirmButton = { TextButton(onClick = onDone) { Text("Done") } },
        )
    }
}

/** A grouped card: surfaceContainer fill, 1 dp outlineVariant stroke, 16 dp corners. */
@Composable
private fun Panel(content: @Composable ColumnScope.() -> Unit) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainer,
        shape = RoundedCornerShape(16.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        modifier = Modifier.fillMaxWidth(),
    ) { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp), content = content) }
}
