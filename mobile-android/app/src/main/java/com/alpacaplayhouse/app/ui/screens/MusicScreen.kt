package com.alpacaplayhouse.app.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import com.alpacaplayhouse.app.ui.theme.LocalIsDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.alpacaplayhouse.app.data.AuthManager
import com.alpacaplayhouse.app.data.SonosApi
import com.alpacaplayhouse.app.data.SonosState
import com.alpacaplayhouse.app.ui.theme.*
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// All Sonos rooms — Skyloft Sound and MasterBlaster require room assignment
private val ALL_SONOS_ROOMS = listOf(
    "Living Sound",
    "Dining Sound",
    "Skyloft Sound",
    "Front Outside Sound",
    "Backyard Sound",
    "Pequeno",
    "MasterBlaster",
    "DJ",
    "Outhouse",
    "garage outdoors",
)

// Rooms that require assignment (private dwelling rooms)
private val RESTRICTED_ROOMS = setOf("Skyloft Sound", "MasterBlaster")

private val AMBIENT_PLAYLISTS = listOf(
    "Ambient Music",
    "Barb Jungr Chill2",
    "chill cats",
    "CHILL LIST",
    "Indian Chill Music",
    "Deep Focus",
    "morningtime",
    "Saturday Morning Mix",
    "Sunday Afternoon Mix",
    "Thursday Afternoon Mix",
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MusicScreen() {
    val scope = rememberCoroutineScope()
    val isDark = LocalIsDarkTheme.current

    // Filter rooms based on role — admin/staff see all, others skip private rooms
    val visibleRooms = remember {
        val role = AuthManager.userRole
        val isAdmin = role == "admin" || role == "staff"
        if (isAdmin) ALL_SONOS_ROOMS else ALL_SONOS_ROOMS.filter { it !in RESTRICTED_ROOMS }
    }

    var selectedRoom by remember { mutableStateOf(visibleRooms.first()) }
    var roomDropdownExpanded by remember { mutableStateOf(false) }
    var sonosState by remember { mutableStateOf<SonosState?>(null) }
    var statusMessage by remember { mutableStateOf<String?>(null) }
    var isLoading by remember { mutableStateOf(false) }

    // Poll state for selected room
    LaunchedEffect(selectedRoom) {
        while (true) {
            SonosApi.getState(selectedRoom).onSuccess { sonosState = it }
            delay(5000)
        }
    }

    // Auto-dismiss status message
    LaunchedEffect(statusMessage) {
        if (statusMessage != null) {
            delay(3000)
            statusMessage = null
        }
    }

    val glassCardBg = if (isDark) AlpacaDarkSurface.copy(alpha = 0.6f) else Color.White.copy(alpha = 0.85f)
    val glassCardBorder = if (isDark) BorderStroke(0.5.dp, AlpacaLuxe.glassBorder) else BorderStroke(0.5.dp, AlpacaLuxe.glassBorderLightMode)
    val cardShape = RoundedCornerShape(AlpacaLuxe.cardRadius.dp)

    Column(
        modifier = Modifier.fillMaxSize()
    ) {
        // Gradient header area
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
                .padding(horizontal = 20.dp, vertical = 24.dp)
        ) {
            Column {
                Text(
                    text = "Music",
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                    color = if (isDark) Color.White else AlpacaText,
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = selectedRoom,
                    style = MaterialTheme.typography.bodyMedium,
                    color = AlpacaMuted,
                )
            }
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 20.dp)
        ) {
            Spacer(modifier = Modifier.height(16.dp))

            // Glass-morphic room selector
            ExposedDropdownMenuBox(
                expanded = roomDropdownExpanded,
                onExpandedChange = { roomDropdownExpanded = it },
            ) {
                Surface(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(cardShape)
                        .border(glassCardBorder, cardShape),
                    color = glassCardBg,
                    shape = cardShape,
                ) {
                    OutlinedTextField(
                        value = selectedRoom,
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("Room", color = AlpacaMuted) },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = roomDropdownExpanded) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .menuAnchor(MenuAnchorType.PrimaryNotEditable),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = Color.Transparent,
                            unfocusedBorderColor = Color.Transparent,
                            focusedTextColor = if (isDark) Color.White else AlpacaText,
                            unfocusedTextColor = if (isDark) Color.White else AlpacaText,
                        ),
                    )
                }
                ExposedDropdownMenu(
                    expanded = roomDropdownExpanded,
                    onDismissRequest = { roomDropdownExpanded = false },
                ) {
                    visibleRooms.forEach { room ->
                        DropdownMenuItem(
                            text = { Text(room) },
                            onClick = {
                                selectedRoom = room
                                roomDropdownExpanded = false
                                sonosState = null
                            },
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Status message
            statusMessage?.let { msg ->
                Text(
                    text = msg,
                    style = MaterialTheme.typography.bodySmall,
                    color = AlpacaPrimary,
                    modifier = Modifier.padding(bottom = 8.dp),
                )
            }

            // Playlists header
            Text(
                text = "Ambient Playlists",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = if (isDark) Color.White else AlpacaText,
            )

            Spacer(modifier = Modifier.height(12.dp))

            // Playlist list
            LazyColumn(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(AMBIENT_PLAYLISTS) { playlist ->
                    PlaylistItem(
                        name = playlist,
                        isPlaying = sonosState?.currentTrack?.title == playlist &&
                            sonosState?.playbackState == "PLAYING",
                        isDark = isDark,
                        onClick = {
                            scope.launch {
                                isLoading = true
                                SonosApi.playPlaylist(selectedRoom, playlist)
                                    .onSuccess { statusMessage = "Playing \"$playlist\" on $selectedRoom" }
                                    .onFailure { statusMessage = "Failed: ${it.message}" }
                                isLoading = false
                            }
                        },
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Now Playing bar
            NowPlayingBar(
                state = sonosState,
                room = selectedRoom,
                isLoading = isLoading,
                isDark = isDark,
                onPlayPause = {
                    scope.launch {
                        SonosApi.playPause(selectedRoom)
                            .onFailure { statusMessage = "Failed: ${it.message}" }
                        // Refresh state
                        delay(500)
                        SonosApi.getState(selectedRoom).onSuccess { sonosState = it }
                    }
                },
                onStop = {
                    scope.launch {
                        SonosApi.stop(selectedRoom)
                            .onFailure { statusMessage = "Failed: ${it.message}" }
                        delay(500)
                        SonosApi.getState(selectedRoom).onSuccess { sonosState = it }
                    }
                },
            )

            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}

@Composable
private fun PlaylistItem(
    name: String,
    isPlaying: Boolean,
    isDark: Boolean,
    onClick: () -> Unit,
) {
    val cardShape = RoundedCornerShape(AlpacaLuxe.cardRadius.dp)
    val glassCardBg = if (isDark) AlpacaDarkSurface.copy(alpha = 0.6f) else Color.White.copy(alpha = 0.85f)
    val containerColor = if (isPlaying) {
        AlpacaPrimary.copy(alpha = 0.12f)
    } else {
        glassCardBg
    }
    val borderStroke = if (isPlaying) {
        BorderStroke(1.5.dp, AlpacaPrimary)
    } else {
        if (isDark) BorderStroke(0.5.dp, AlpacaLuxe.glassBorder) else BorderStroke(0.5.dp, AlpacaLuxe.glassBorderLightMode)
    }

    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clip(cardShape)
            .border(borderStroke, cardShape)
            .clickable(onClick = onClick),
        color = containerColor,
        shape = cardShape,
    ) {
        Row(
            modifier = Modifier
                .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = if (isPlaying) Icons.Default.PlayCircle else Icons.Default.MusicNote,
                contentDescription = null,
                tint = if (isPlaying) AlpacaPrimary else AlpacaMuted,
                modifier = Modifier.size(24.dp),
            )
            Spacer(modifier = Modifier.width(12.dp))
            Text(
                text = name,
                style = MaterialTheme.typography.bodyLarge,
                color = if (isPlaying) {
                    if (isDark) Color.White else AlpacaText
                } else {
                    if (isDark) Color.White.copy(alpha = 0.8f) else AlpacaText
                },
            )
        }
    }
}

@Composable
private fun NowPlayingBar(
    state: SonosState?,
    room: String,
    isLoading: Boolean,
    isDark: Boolean,
    onPlayPause: () -> Unit,
    onStop: () -> Unit,
) {
    val isPlaying = state?.playbackState == "PLAYING"
    val trackTitle = state?.currentTrack?.title ?: ""
    val trackArtist = state?.currentTrack?.artist ?: ""
    val hasTrack = trackTitle.isNotBlank()

    val cardShape = RoundedCornerShape(AlpacaLuxe.cardRadiusLarge.dp)
    val glassCardBg = if (isDark) AlpacaDarkSurface.copy(alpha = 0.6f) else Color.White.copy(alpha = 0.85f)
    val glassCardBorder = if (isDark) BorderStroke(0.5.dp, AlpacaLuxe.glassBorder) else BorderStroke(0.5.dp, AlpacaLuxe.glassBorderLightMode)

    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .shadow(
                elevation = 12.dp,
                shape = cardShape,
                ambientColor = AlpacaPrimary.copy(alpha = 0.2f),
                spotColor = AlpacaPrimary.copy(alpha = 0.15f),
            )
            .clip(cardShape)
            .border(glassCardBorder, cardShape),
        color = glassCardBg,
        shape = cardShape,
    ) {
        Row(
            modifier = Modifier
                .padding(16.dp)
                .fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Track info
            Column(modifier = Modifier.weight(1f)) {
                if (hasTrack) {
                    Text(
                        text = trackTitle,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = if (isDark) Color.White else AlpacaText,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (trackArtist.isNotBlank()) {
                        Text(
                            text = trackArtist,
                            style = MaterialTheme.typography.bodySmall,
                            color = AlpacaMuted,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                } else {
                    Text(
                        text = if (state == null) "Connecting to $room..." else "Nothing playing",
                        style = MaterialTheme.typography.bodyMedium,
                        color = AlpacaMuted,
                    )
                }
            }

            // Controls
            if (isLoading) {
                CircularProgressIndicator(
                    modifier = Modifier.size(24.dp),
                    strokeWidth = 2.dp,
                    color = AlpacaPrimary,
                )
            } else {
                // Play/Pause button with salmon accent fill
                IconButton(
                    onClick = onPlayPause,
                    modifier = Modifier
                        .size(44.dp)
                        .background(
                            color = AlpacaAccent,
                            shape = CircleShape,
                        ),
                ) {
                    Icon(
                        imageVector = if (isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                        contentDescription = if (isPlaying) "Pause" else "Play",
                        tint = Color.White,
                    )
                }
                Spacer(modifier = Modifier.width(4.dp))
                IconButton(onClick = onStop) {
                    Icon(
                        imageVector = Icons.Default.Stop,
                        contentDescription = "Stop",
                        tint = AlpacaMuted,
                    )
                }
            }
        }
    }
}
