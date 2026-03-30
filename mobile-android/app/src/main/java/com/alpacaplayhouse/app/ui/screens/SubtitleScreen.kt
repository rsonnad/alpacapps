package com.alpacaplayhouse.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alpacaplayhouse.app.data.ApiConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.*
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale

data class SubtitleSegment(
    val id: String,
    val text: String,
    val lang: String,
    val sourceLang: String,
    val sourceText: String,
    val timestamp: Long,
    val isPartial: Boolean,
)

private val SUPPORTED_LANGS = listOf(
    "en" to "English",
    "pl" to "Polski",
    "es" to "Espanol",
    "fr" to "Francais",
    "de" to "Deutsch",
    "pt" to "Portugues",
    "it" to "Italiano",
    "hi" to "Hindi",
    "ar" to "Arabic",
)

private const val SUBTITLE_WS_HOST = "alpuca.local"
private const val SUBTITLE_WS_PORT = 8910
private const val MAX_SEGMENTS = 50

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SubtitleScreen() {
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()

    // Detect phone locale for default language
    val phoneLocale = Locale.getDefault().language
    val defaultLang = if (SUPPORTED_LANGS.any { it.first == phoneLocale }) phoneLocale else "en"

    var selectedLang by remember { mutableStateOf(defaultLang) }
    var langDropdownExpanded by remember { mutableStateOf(false) }
    var segments by remember { mutableStateOf(listOf<SubtitleSegment>()) }
    var connectionStatus by remember { mutableStateOf("checking") } // checking, connected, disconnected, unavailable
    var serverActive by remember { mutableStateOf(false) }
    var fontSize by remember { mutableIntStateOf(20) }
    var ws by remember { mutableStateOf<WebSocket?>(null) }

    // Check server availability
    LaunchedEffect(Unit) {
        while (true) {
            serverActive = checkSubtitleServer()
            if (!serverActive) connectionStatus = "unavailable"
            delay(30_000)
        }
    }

    // Connect WebSocket when lang changes and server is active
    LaunchedEffect(selectedLang, serverActive) {
        if (!serverActive) return@LaunchedEffect

        // Close existing
        ws?.close(1000, "language change")
        connectionStatus = "connecting"

        val client = OkHttpClient()
        val request = Request.Builder()
            .url("ws://$SUBTITLE_WS_HOST:$SUBTITLE_WS_PORT/subtitles?lang=$selectedLang")
            .build()

        val newWs = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                connectionStatus = "connected"
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val json = JSONObject(text)
                if (json.optString("type") != "subtitle") return

                val seg = SubtitleSegment(
                    id = json.getString("id"),
                    text = json.getString("text"),
                    lang = json.getString("lang"),
                    sourceLang = json.getString("source_lang"),
                    sourceText = json.getString("source_text"),
                    timestamp = json.getLong("timestamp"),
                    isPartial = json.getBoolean("is_partial"),
                )

                val updated = segments.toMutableList()
                if (seg.isPartial) {
                    val idx = updated.indexOfFirst { it.id == seg.id && it.isPartial }
                    if (idx >= 0) updated[idx] = seg else updated.add(seg)
                } else {
                    updated.removeAll { it.id == seg.id && it.isPartial }
                    updated.add(seg)
                }
                while (updated.size > MAX_SEGMENTS) updated.removeAt(0)
                segments = updated
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                connectionStatus = "disconnected"
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                connectionStatus = "disconnected"
            }
        })

        ws = newWs
    }

    // Auto-scroll when new segments arrive
    LaunchedEffect(segments.size) {
        if (segments.isNotEmpty()) {
            listState.animateScrollToItem(segments.size - 1)
        }
    }

    // Clean up on dispose
    DisposableEffect(Unit) {
        onDispose { ws?.close(1000, "screen closed") }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF110E10))
    ) {
        // Header
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Status dot
            val dotColor = when (connectionStatus) {
                "connected" -> Color(0xFF5CB85C)
                "connecting" -> Color(0xFFE99C48)
                else -> Color(0xFFD9534F)
            }
            Box(
                modifier = Modifier
                    .size(10.dp)
                    .background(dotColor, shape = MaterialTheme.shapes.small)
            )
            Spacer(modifier = Modifier.width(8.dp))

            Text(
                text = "Live Subtitles",
                fontSize = 20.sp,
                fontWeight = FontWeight.SemiBold,
                color = Color(0xFF5CB85C),
                modifier = Modifier.weight(1f),
            )

            // Font size controls
            IconButton(onClick = { fontSize = (fontSize - 2).coerceAtLeast(12) }) {
                Icon(Icons.Default.TextDecrease, "Smaller", tint = Color(0xFFF5F4ED))
            }
            IconButton(onClick = { fontSize = (fontSize + 2).coerceAtMost(40) }) {
                Icon(Icons.Default.TextIncrease, "Larger", tint = Color(0xFFF5F4ED))
            }
        }

        // Language picker
        ExposedDropdownMenuBox(
            expanded = langDropdownExpanded,
            onExpandedChange = { langDropdownExpanded = it },
            modifier = Modifier.padding(horizontal = 16.dp),
        ) {
            OutlinedTextField(
                value = SUPPORTED_LANGS.first { it.first == selectedLang }.second,
                onValueChange = {},
                readOnly = true,
                label = { Text("Language", color = Color(0xFF8A7E82)) },
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = langDropdownExpanded) },
                modifier = Modifier
                    .fillMaxWidth()
                    .menuAnchor(MenuAnchorType.PrimaryNotEditable),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedTextColor = Color(0xFFF5F4ED),
                    unfocusedTextColor = Color(0xFFF5F4ED),
                    focusedBorderColor = Color(0xFF5CB85C),
                    unfocusedBorderColor = Color(0xFF2E282B),
                    focusedContainerColor = Color(0xFF1E1A1C),
                    unfocusedContainerColor = Color(0xFF1E1A1C),
                ),
            )
            ExposedDropdownMenu(
                expanded = langDropdownExpanded,
                onDismissRequest = { langDropdownExpanded = false },
            ) {
                SUPPORTED_LANGS.forEach { (code, name) ->
                    DropdownMenuItem(
                        text = { Text(name) },
                        onClick = {
                            selectedLang = code
                            segments = emptyList()
                            langDropdownExpanded = false
                        },
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(8.dp))

        // Status text
        Text(
            text = when (connectionStatus) {
                "connected" -> "Connected ($selectedLang)"
                "connecting" -> "Connecting..."
                "unavailable" -> "Subtitle server not available"
                else -> "Disconnected — retrying..."
            },
            fontSize = 12.sp,
            color = Color(0xFF8A7E82),
            modifier = Modifier.padding(horizontal = 16.dp),
        )

        Spacer(modifier = Modifier.height(8.dp))

        // Subtitle content
        if (!serverActive) {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(
                        Icons.Default.SubtitlesOff,
                        contentDescription = null,
                        tint = Color(0xFF8A7E82),
                        modifier = Modifier.size(48.dp),
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    Text(
                        "Subtitles are not active right now",
                        color = Color(0xFF8A7E82),
                        fontSize = 16.sp,
                    )
                    Text(
                        "They'll appear here during events",
                        color = Color(0xFF5A5055),
                        fontSize = 13.sp,
                    )
                }
            }
        } else if (segments.isEmpty()) {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    "Waiting for subtitles...",
                    color = Color(0xFF8A7E82),
                    fontSize = 16.sp,
                )
            }
        } else {
            LazyColumn(
                state = listState,
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                contentPadding = PaddingValues(vertical = 12.dp),
            ) {
                items(segments, key = { "${it.id}_${it.isPartial}" }) { seg ->
                    Column {
                        // Original language: dim, smaller, on top (when translated)
                        if (seg.lang != seg.sourceLang && seg.sourceText.isNotBlank()) {
                            Text(
                                text = seg.sourceText,
                                fontSize = (fontSize * 0.6).sp,
                                color = Color(0xFF8A7E82).copy(alpha = 0.7f),
                                fontStyle = if (seg.isPartial) FontStyle.Italic else FontStyle.Normal,
                                lineHeight = (fontSize * 0.9).sp,
                            )
                            Spacer(modifier = Modifier.height(4.dp))
                        }
                        // Preferred language: full size, bright
                        Text(
                            text = seg.text,
                            fontSize = fontSize.sp,
                            color = if (seg.isPartial) Color(0xFF8A7E82) else Color(0xFFF5F4ED),
                            fontStyle = if (seg.isPartial) FontStyle.Italic else FontStyle.Normal,
                            lineHeight = (fontSize * 1.5).sp,
                        )
                    }
                }
            }
        }
    }
}

private suspend fun checkSubtitleServer(): Boolean = withContext(Dispatchers.IO) {
    try {
        val url = URL("http://$SUBTITLE_WS_HOST:$SUBTITLE_WS_PORT/subtitles/status")
        val conn = url.openConnection() as HttpURLConnection
        conn.connectTimeout = 3000
        conn.readTimeout = 3000
        val response = conn.inputStream.bufferedReader().readText()
        conn.disconnect()
        val json = JSONObject(response)
        json.optBoolean("active", false)
    } catch (e: Exception) {
        false
    }
}
