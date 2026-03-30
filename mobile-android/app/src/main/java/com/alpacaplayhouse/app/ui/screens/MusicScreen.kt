package com.alpacaplayhouse.app.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.alpacaplayhouse.app.data.SonosApi
import com.alpacaplayhouse.app.data.SonosState
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val SONOS_ROOMS = listOf(
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
    var selectedRoom by remember { mutableStateOf(SONOS_ROOMS.first()) }
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

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
    ) {
        // Header
        Text(
            text = "Music",
            style = MaterialTheme.typography.headlineMedium,
            color = MaterialTheme.colorScheme.onBackground,
        )

        Spacer(modifier = Modifier.height(16.dp))

        // Room Picker
        ExposedDropdownMenuBox(
            expanded = roomDropdownExpanded,
            onExpandedChange = { roomDropdownExpanded = it },
        ) {
            OutlinedTextField(
                value = selectedRoom,
                onValueChange = {},
                readOnly = true,
                label = { Text("Room") },
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = roomDropdownExpanded) },
                modifier = Modifier
                    .fillMaxWidth()
                    .menuAnchor(MenuAnchorType.PrimaryNotEditable),
                colors = ExposedDropdownMenuDefaults.outlinedTextFieldColors(),
            )
            ExposedDropdownMenu(
                expanded = roomDropdownExpanded,
                onDismissRequest = { roomDropdownExpanded = false },
            ) {
                SONOS_ROOMS.forEach { room ->
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
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(bottom = 8.dp),
            )
        }

        // Playlists header
        Text(
            text = "Ambient Playlists",
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onBackground,
        )

        Spacer(modifier = Modifier.height(8.dp))

        // Playlist list
        LazyColumn(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            items(AMBIENT_PLAYLISTS) { playlist ->
                PlaylistItem(
                    name = playlist,
                    isPlaying = sonosState?.currentTrack?.title == playlist &&
                        sonosState?.playbackState == "PLAYING",
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

        // Now Playing bar
        NowPlayingBar(
            state = sonosState,
            room = selectedRoom,
            isLoading = isLoading,
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
    }
}

@Composable
private fun PlaylistItem(
    name: String,
    isPlaying: Boolean,
    onClick: () -> Unit,
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        colors = CardDefaults.cardColors(
            containerColor = if (isPlaying)
                MaterialTheme.colorScheme.primaryContainer
            else
                MaterialTheme.colorScheme.surfaceVariant,
        ),
    ) {
        Row(
            modifier = Modifier
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = if (isPlaying) Icons.Default.PlayCircle else Icons.Default.MusicNote,
                contentDescription = null,
                tint = if (isPlaying)
                    MaterialTheme.colorScheme.onPrimaryContainer
                else
                    MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(24.dp),
            )
            Spacer(modifier = Modifier.width(12.dp))
            Text(
                text = name,
                style = MaterialTheme.typography.bodyLarge,
                color = if (isPlaying)
                    MaterialTheme.colorScheme.onPrimaryContainer
                else
                    MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun NowPlayingBar(
    state: SonosState?,
    room: String,
    isLoading: Boolean,
    onPlayPause: () -> Unit,
    onStop: () -> Unit,
) {
    val isPlaying = state?.playbackState == "PLAYING"
    val trackTitle = state?.currentTrack?.title ?: ""
    val trackArtist = state?.currentTrack?.artist ?: ""
    val hasTrack = trackTitle.isNotBlank()

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 8.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface,
        ),
    ) {
        Row(
            modifier = Modifier
                .padding(12.dp)
                .fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Track info
            Column(modifier = Modifier.weight(1f)) {
                if (hasTrack) {
                    Text(
                        text = trackTitle,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (trackArtist.isNotBlank()) {
                        Text(
                            text = trackArtist,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                } else {
                    Text(
                        text = if (state == null) "Connecting to $room..." else "Nothing playing",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            // Controls
            if (isLoading) {
                CircularProgressIndicator(
                    modifier = Modifier.size(24.dp),
                    strokeWidth = 2.dp,
                )
            } else {
                IconButton(onClick = onPlayPause) {
                    Icon(
                        imageVector = if (isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                        contentDescription = if (isPlaying) "Pause" else "Play",
                        tint = MaterialTheme.colorScheme.primary,
                    )
                }
                IconButton(onClick = onStop) {
                    Icon(
                        imageVector = Icons.Default.Stop,
                        contentDescription = "Stop",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}
