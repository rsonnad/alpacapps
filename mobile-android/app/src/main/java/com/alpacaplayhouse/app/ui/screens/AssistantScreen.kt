package com.alpacaplayhouse.app.ui.screens

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import com.alpacaplayhouse.app.ui.theme.LocalIsDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AddComment
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.alpacaplayhouse.app.data.HaosApi
import com.alpacaplayhouse.app.ui.theme.*
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.encodeToString

data class ChatMessage(
    val text: String,
    val isUser: Boolean,
    val timestamp: Long = System.currentTimeMillis(),
)

@Serializable
data class PromptEntry(
    val text: String,
    val isFavorite: Boolean = false,
    val lastUsed: Long = System.currentTimeMillis(),
)

// Simple prompt history persisted in SharedPreferences
object PromptHistory {
    private const val PREFS = "prompt_history"
    private const val KEY = "prompts"
    private val json = Json { ignoreUnknownKeys = true }

    fun load(context: Context): List<PromptEntry> {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY, null) ?: return emptyList()
        return try { json.decodeFromString<List<PromptEntry>>(raw) } catch (_: Exception) { emptyList() }
    }

    fun save(context: Context, entries: List<PromptEntry>) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY, json.encodeToString(entries)).apply()
    }

    fun addPrompt(context: Context, text: String) {
        val entries = load(context).toMutableList()
        // Update existing or add new
        val idx = entries.indexOfFirst { it.text.equals(text, ignoreCase = true) }
        if (idx >= 0) {
            entries[idx] = entries[idx].copy(lastUsed = System.currentTimeMillis())
        } else {
            entries.add(0, PromptEntry(text = text))
        }
        // Keep max 30
        save(context, entries.take(30))
    }

    fun toggleFavorite(context: Context, text: String) {
        val entries = load(context).toMutableList()
        val idx = entries.indexOfFirst { it.text.equals(text, ignoreCase = true) }
        if (idx >= 0) {
            entries[idx] = entries[idx].copy(isFavorite = !entries[idx].isFavorite)
            save(context, entries)
        }
    }

    fun delete(context: Context, text: String) {
        val entries = load(context).toMutableList()
        entries.removeAll { it.text.equals(text, ignoreCase = true) }
        save(context, entries)
    }
}

@Composable
fun AssistantScreen() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    val isDark = LocalIsDarkTheme.current

    val messages = remember { mutableStateListOf<ChatMessage>() }
    var inputText by remember { mutableStateOf("") }
    var isLoading by remember { mutableStateOf(false) }
    var isListening by remember { mutableStateOf(false) }
    var conversationId by remember { mutableStateOf<String?>(null) }
    var promptEntries by remember { mutableStateOf(PromptHistory.load(context)) }

    val speechRecognizer = remember {
        if (SpeechRecognizer.isRecognitionAvailable(context)) {
            SpeechRecognizer.createSpeechRecognizer(context)
        } else null
    }

    DisposableEffect(Unit) {
        onDispose { speechRecognizer?.destroy() }
    }

    fun sendMessage(text: String) {
        if (text.isBlank() || isLoading) return
        val userMessage = ChatMessage(text = text.trim(), isUser = true)
        messages.add(userMessage)
        inputText = ""
        isLoading = true

        // Save to history
        PromptHistory.addPrompt(context, text.trim())
        promptEntries = PromptHistory.load(context)

        scope.launch {
            listState.animateScrollToItem(messages.size - 1)

            val result = HaosApi.sendMessage(
                text = userMessage.text,
                conversationId = conversationId,
            )

            result.onSuccess { response ->
                conversationId = response.conversationId
                messages.add(ChatMessage(text = response.speech, isUser = false))
            }.onFailure { error ->
                messages.add(
                    ChatMessage(
                        text = "Error: ${error.message ?: "Failed to reach assistant"}",
                        isUser = false,
                    )
                )
            }

            isLoading = false
            if (messages.isNotEmpty()) {
                listState.animateScrollToItem(messages.size - 1)
            }
        }
    }

    fun startListening() {
        val hasPermission = ContextCompat.checkSelfPermission(
            context, Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED

        if (!hasPermission) {
            ActivityCompat.requestPermissions(
                context as Activity,
                arrayOf(Manifest.permission.RECORD_AUDIO),
                100
            )
            return
        }

        if (speechRecognizer == null) {
            messages.add(ChatMessage(text = "Speech recognition not available.", isUser = false))
            return
        }

        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-US")
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        }

        speechRecognizer.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) { isListening = true }
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() { isListening = false }
            override fun onError(error: Int) { isListening = false }
            override fun onResults(results: Bundle?) {
                isListening = false
                val spokenText = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
                if (!spokenText.isNullOrBlank()) sendMessage(spokenText)
            }
            override fun onPartialResults(partialResults: Bundle?) {
                val partial = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
                if (!partial.isNullOrBlank()) inputText = partial
            }
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })

        speechRecognizer.startListening(intent)
    }

    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) listState.animateScrollToItem(messages.size - 1)
    }

    Column(modifier = Modifier.fillMaxSize()) {
        // Gradient header (replaces TopAppBar)
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .background(
                    Brush.verticalGradient(
                        colors = listOf(
                            AlpacaPrimary.copy(alpha = 0.3f),
                            Color.Transparent,
                        )
                    )
                )
                .padding(horizontal = 20.dp, vertical = 16.dp),
        ) {
            Column(modifier = Modifier.align(Alignment.CenterStart)) {
                Text(
                    text = "Smart Assistant",
                    fontSize = 24.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Text(
                    text = "Powered by HAOS + Ollama",
                    fontSize = 12.sp,
                    color = AlpacaMuted,
                )
            }
            IconButton(
                onClick = {
                    conversationId = null
                    messages.clear()
                },
                modifier = Modifier.align(Alignment.CenterEnd),
            ) {
                Icon(
                    Icons.Default.AddComment,
                    contentDescription = "New conversation",
                    tint = MaterialTheme.colorScheme.onSurface,
                )
            }
        }

        // Chat or prompt history
        LazyColumn(
            state = listState,
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (messages.isEmpty()) {
                // Show prompt history when no active conversation
                val favorites = promptEntries.filter { it.isFavorite }.sortedByDescending { it.lastUsed }
                val recent = promptEntries.filter { !it.isFavorite }.sortedByDescending { it.lastUsed }

                if (favorites.isNotEmpty()) {
                    item {
                        Text(
                            text = "Favorites",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = AlpacaPrimary,
                            modifier = Modifier.padding(top = 8.dp, bottom = 4.dp),
                        )
                    }
                    items(favorites, key = { "fav-${it.text}" }) { entry ->
                        PromptChip(
                            entry = entry,
                            isDark = isDark,
                            onTap = { sendMessage(entry.text) },
                            onToggleFavorite = {
                                PromptHistory.toggleFavorite(context, entry.text)
                                promptEntries = PromptHistory.load(context)
                            },
                            onDelete = {
                                PromptHistory.delete(context, entry.text)
                                promptEntries = PromptHistory.load(context)
                            },
                        )
                    }
                }

                if (recent.isNotEmpty()) {
                    item {
                        Text(
                            text = if (favorites.isNotEmpty()) "Recent" else "Recent Prompts",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = AlpacaMuted,
                            modifier = Modifier.padding(top = if (favorites.isNotEmpty()) 16.dp else 8.dp, bottom = 4.dp),
                        )
                    }
                    items(recent.take(15), key = { "rec-${it.text}" }) { entry ->
                        PromptChip(
                            entry = entry,
                            isDark = isDark,
                            onTap = { sendMessage(entry.text) },
                            onToggleFavorite = {
                                PromptHistory.toggleFavorite(context, entry.text)
                                promptEntries = PromptHistory.load(context)
                            },
                            onDelete = {
                                PromptHistory.delete(context, entry.text)
                                promptEntries = PromptHistory.load(context)
                            },
                        )
                    }
                }

                if (promptEntries.isEmpty()) {
                    item {
                        Box(
                            modifier = Modifier.fillParentMaxSize(),
                            contentAlignment = Alignment.Center,
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(
                                    text = "Ask me anything about your home",
                                    fontSize = 18.sp,
                                    fontWeight = FontWeight.Medium,
                                    color = MaterialTheme.colorScheme.onSurface,
                                )
                                Spacer(modifier = Modifier.height(6.dp))
                                Text(
                                    text = "\"Turn on the living room lights\"",
                                    fontSize = 15.sp,
                                    color = AlpacaMuted,
                                )
                            }
                        }
                    }
                }
            }

            items(messages) { message ->
                ChatBubble(message = message, isDark = isDark)
            }

            if (isLoading) {
                item { TypingIndicator(isDark = isDark) }
            }
        }

        // Glass input bar
        Surface(
            modifier = Modifier.imePadding(),
            color = if (isDark) AlpacaDarkSurface.copy(alpha = 0.8f) else Color.White.copy(alpha = 0.95f),
            tonalElevation = 0.dp,
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextField(
                    value = inputText,
                    onValueChange = { inputText = it },
                    placeholder = {
                        Text(if (isListening) "Listening..." else "Ask something...")
                    },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                    colors = TextFieldDefaults.colors(
                        focusedContainerColor = Color.Transparent,
                        unfocusedContainerColor = Color.Transparent,
                        focusedIndicatorColor = Color.Transparent,
                        unfocusedIndicatorColor = Color.Transparent,
                        disabledIndicatorColor = Color.Transparent,
                    ),
                )
                IconButton(
                    onClick = { sendMessage(inputText) },
                    enabled = inputText.isNotBlank() && !isLoading,
                ) {
                    Icon(
                        Icons.AutoMirrored.Filled.Send,
                        contentDescription = "Send",
                        tint = if (inputText.isNotBlank() && !isLoading)
                            AlpacaPrimary
                        else
                            MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f),
                    )
                }
                MicButton(
                    isListening = isListening,
                    onClick = {
                        if (isListening) {
                            speechRecognizer?.stopListening()
                            isListening = false
                        } else {
                            startListening()
                        }
                    },
                )
            }
        }
    }
}

@Composable
private fun PromptChip(
    entry: PromptEntry,
    isDark: Boolean,
    onTap: () -> Unit,
    onToggleFavorite: () -> Unit,
    onDelete: () -> Unit,
) {
    val glassBackground = if (isDark)
        AlpacaDarkSurface.copy(alpha = 0.6f)
    else
        Color.White.copy(alpha = 0.85f)

    val borderStroke = if (entry.isFavorite)
        BorderStroke(1.dp, AlpacaPrimary.copy(alpha = 0.3f))
    else
        BorderStroke(1.dp, if (isDark) AlpacaLuxe.glassBorder else AlpacaLuxe.glassBorderLightMode)

    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onTap),
        shape = RoundedCornerShape(AlpacaLuxe.chipRadius.dp),
        color = glassBackground,
        border = borderStroke,
    ) {
        Row(
            modifier = Modifier.padding(start = 16.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = entry.text,
                modifier = Modifier.weight(1f),
                fontSize = 14.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                color = MaterialTheme.colorScheme.onSurface,
            )
            IconButton(onClick = onToggleFavorite, modifier = Modifier.size(36.dp)) {
                Icon(
                    if (entry.isFavorite) Icons.Default.Star else Icons.Default.StarBorder,
                    contentDescription = "Favorite",
                    modifier = Modifier.size(18.dp),
                    tint = if (entry.isFavorite) Color(0xFFE8A317) else AlpacaMuted,
                )
            }
            IconButton(onClick = onDelete, modifier = Modifier.size(36.dp)) {
                Icon(
                    Icons.Default.Close,
                    contentDescription = "Delete",
                    modifier = Modifier.size(16.dp),
                    tint = AlpacaMuted,
                )
            }
        }
    }
}

@Composable
private fun ChatBubble(message: ChatMessage, isDark: Boolean) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (message.isUser) Arrangement.End else Arrangement.Start,
    ) {
        val bubbleShape = RoundedCornerShape(
            topStart = AlpacaLuxe.cardRadius.dp,
            topEnd = AlpacaLuxe.cardRadius.dp,
            bottomStart = if (message.isUser) AlpacaLuxe.cardRadius.dp else 4.dp,
            bottomEnd = if (message.isUser) 4.dp else AlpacaLuxe.cardRadius.dp,
        )

        if (message.isUser) {
            Surface(
                shape = bubbleShape,
                color = AlpacaPrimary,
                modifier = Modifier.widthIn(max = 300.dp),
            ) {
                Text(
                    text = message.text,
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                    style = MaterialTheme.typography.bodyLarge,
                    color = Color.White,
                )
            }
        } else {
            // Glass assistant bubble
            val glassBg = if (isDark)
                AlpacaDarkSurface.copy(alpha = 0.6f)
            else
                Color.White.copy(alpha = 0.85f)
            val glassBorderColor = if (isDark)
                AlpacaLuxe.glassBorder
            else
                AlpacaLuxe.glassBorderLightMode

            Surface(
                shape = bubbleShape,
                color = glassBg,
                border = BorderStroke(1.dp, glassBorderColor),
                modifier = Modifier.widthIn(max = 300.dp),
            ) {
                Text(
                    text = message.text,
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }
        }
    }
}

@Composable
private fun MicButton(isListening: Boolean, onClick: () -> Unit) {
    val infiniteTransition = rememberInfiniteTransition(label = "mic-pulse")
    val pulseAlpha by infiniteTransition.animateFloat(
        initialValue = 1f, targetValue = 0.4f,
        animationSpec = infiniteRepeatable(animation = tween(600), repeatMode = RepeatMode.Reverse),
        label = "mic-pulse-alpha",
    )

    IconButton(onClick = onClick) {
        Box(contentAlignment = Alignment.Center) {
            if (isListening) {
                Box(
                    modifier = Modifier
                        .size(40.dp)
                        .alpha(pulseAlpha)
                        .clip(CircleShape)
                        .background(AlpacaAccent.copy(alpha = 0.2f))
                )
            }
            Icon(
                Icons.Default.Mic,
                contentDescription = if (isListening) "Stop listening" else "Voice input",
                tint = if (isListening) AlpacaAccent else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun TypingIndicator(isDark: Boolean) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.Start,
    ) {
        val glassBg = if (isDark)
            AlpacaDarkSurface.copy(alpha = 0.6f)
        else
            Color.White.copy(alpha = 0.85f)
        val glassBorderColor = if (isDark)
            AlpacaLuxe.glassBorder
        else
            AlpacaLuxe.glassBorderLightMode

        Surface(
            shape = RoundedCornerShape(16.dp),
            color = glassBg,
            border = BorderStroke(1.dp, glassBorderColor),
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                val transition = rememberInfiniteTransition(label = "typing")
                repeat(3) { index ->
                    val alpha by transition.animateFloat(
                        initialValue = 0.3f, targetValue = 1f,
                        animationSpec = infiniteRepeatable(
                            animation = tween(500, delayMillis = index * 150),
                            repeatMode = RepeatMode.Reverse,
                        ),
                        label = "dot-$index",
                    )
                    Box(
                        modifier = Modifier
                            .size(8.dp)
                            .alpha(alpha)
                            .clip(CircleShape)
                            .background(AlpacaPrimary.copy(alpha = 0.6f))
                    )
                }
            }
        }
    }
}
