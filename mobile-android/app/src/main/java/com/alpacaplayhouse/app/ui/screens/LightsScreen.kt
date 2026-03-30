package com.alpacaplayhouse.app.ui.screens

import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.LockOpen
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.alpacaplayhouse.app.data.LightApi
import kotlinx.coroutines.launch

// --- Data models ---

private data class LightScene(
    val label: String,
    val color: String,
    val brightness: String,
)

private data class LightZone(
    val name: String,
    val rooms: List<String>,
    val scenes: List<LightScene>,
    val requiresPin: Boolean = false,
)

private val COMMON_SCENES = listOf(
    LightScene("Bright", "white", "100%"),
    LightScene("Warm", "warm", "80%"),
    LightScene("Dim", "warm", "30%"),
    LightScene("Party", "magenta", "100%"),
    LightScene("Off", "off", "0%"),
)

private val OUTSIDE_SCENES = listOf(
    LightScene("Bright", "white", "100%"),
    LightScene("Warm", "warm", "80%"),
    LightScene("Dim", "warm", "30%"),
    LightScene("Welcome", "amber", "100%"),
    LightScene("Party", "magenta", "100%"),
    LightScene("Off", "off", "0%"),
)

private val ZONES = listOf(
    LightZone(
        name = "Outside",
        rooms = listOf("facade", "cabins-fence", "sauna"),
        scenes = OUTSIDE_SCENES,
    ),
    LightZone(
        name = "Living / Dining / Kitchen",
        rooms = listOf("living", "kitchen", "kitchen-nook"),
        scenes = COMMON_SCENES,
    ),
    LightZone(
        name = "Skyloft / Master",
        rooms = listOf("skyloft", "skyloft-bath", "master-bath", "stairs"),
        scenes = COMMON_SCENES,
        requiresPin = true,
    ),
)

private const val UNLOCK_PIN = "1234"

// --- Scene color hints for button tints ---

private fun sceneAccentColor(scene: LightScene): Color = when (scene.label) {
    "Bright" -> Color(0xFFFFF9C4) // warm white
    "Warm" -> Color(0xFFFFCC80)   // amber-ish
    "Dim" -> Color(0xFF8D6E63)    // muted brown
    "Party" -> Color(0xFFE040FB)  // magenta
    "Welcome" -> Color(0xFFFFB300) // amber
    "Off" -> Color(0xFF757575)    // grey
    else -> Color.Unspecified
}

@Composable
fun LightsScreen() {
    val scope = rememberCoroutineScope()
    var skyloftUnlocked by remember { mutableStateOf(false) }
    var showPinDialog by remember { mutableStateOf(false) }
    var statusMessage by remember { mutableStateOf<String?>(null) }

    // Auto-dismiss status
    LaunchedEffect(statusMessage) {
        if (statusMessage != null) {
            kotlinx.coroutines.delay(3000)
            statusMessage = null
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
    ) {
        Text(
            text = "Lights",
            style = MaterialTheme.typography.headlineMedium,
            color = MaterialTheme.colorScheme.onBackground,
        )

        Spacer(modifier = Modifier.height(8.dp))

        statusMessage?.let { msg ->
            Text(
                text = msg,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(bottom = 8.dp),
            )
        }

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(16.dp),
            contentPadding = PaddingValues(bottom = 16.dp),
        ) {
            items(ZONES) { zone ->
                ZoneCard(
                    zone = zone,
                    isUnlocked = !zone.requiresPin || skyloftUnlocked,
                    onLockTap = { showPinDialog = true },
                    onSceneTap = { scene ->
                        scope.launch {
                            val roomsCsv = zone.rooms.joinToString(",")
                            LightApi.controlLights(roomsCsv, scene.color, scene.brightness)
                                .onSuccess {
                                    statusMessage = "${scene.label} applied to ${zone.name}"
                                }
                                .onFailure {
                                    statusMessage = "Failed: ${it.message}"
                                }
                        }
                    },
                )
            }
        }
    }

    // PIN Dialog
    if (showPinDialog) {
        PinDialog(
            onDismiss = { showPinDialog = false },
            onUnlock = {
                skyloftUnlocked = true
                showPinDialog = false
            },
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ZoneCard(
    zone: LightZone,
    isUnlocked: Boolean,
    onLockTap: () -> Unit,
    onSceneTap: (LightScene) -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant,
        ),
        shape = MaterialTheme.shapes.large,
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            // Zone header
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = zone.name,
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.weight(1f),
                )
                if (zone.requiresPin) {
                    IconButton(onClick = onLockTap) {
                        Icon(
                            imageVector = if (isUnlocked) Icons.Default.LockOpen else Icons.Default.Lock,
                            contentDescription = if (isUnlocked) "Unlocked" else "Locked",
                            tint = if (isUnlocked)
                                MaterialTheme.colorScheme.primary
                            else
                                MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }

            // Room names subtitle
            Text(
                text = zone.rooms.joinToString(" / "),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
            )

            Spacer(modifier = Modifier.height(12.dp))

            // Scene buttons
            if (isUnlocked) {
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    zone.scenes.forEach { scene ->
                        SceneButton(
                            scene = scene,
                            onClick = { onSceneTap(scene) },
                        )
                    }
                }
            } else {
                Text(
                    text = "Tap the lock to enter PIN",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 8.dp),
                )
            }
        }
    }
}

@Composable
private fun SceneButton(
    scene: LightScene,
    onClick: () -> Unit,
) {
    val accent = sceneAccentColor(scene)
    val isOff = scene.label == "Off"

    FilledTonalButton(
        onClick = onClick,
        colors = ButtonDefaults.filledTonalButtonColors(
            containerColor = if (isOff)
                MaterialTheme.colorScheme.surfaceVariant
            else
                accent.copy(alpha = 0.2f),
            contentColor = if (isOff)
                MaterialTheme.colorScheme.onSurfaceVariant
            else
                MaterialTheme.colorScheme.onSurface,
        ),
    ) {
        Text(scene.label)
    }
}

@Composable
private fun PinDialog(
    onDismiss: () -> Unit,
    onUnlock: () -> Unit,
) {
    var pin by remember { mutableStateOf("") }
    var error by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Skyloft / Master Access") },
        text = {
            Column {
                Text("Enter the 4-digit PIN to unlock this zone.")
                Spacer(modifier = Modifier.height(12.dp))
                OutlinedTextField(
                    value = pin,
                    onValueChange = {
                        if (it.length <= 4 && it.all { c -> c.isDigit() }) {
                            pin = it
                            error = false
                        }
                    },
                    label = { Text("PIN") },
                    visualTransformation = PasswordVisualTransformation(),
                    isError = error,
                    supportingText = if (error) {
                        { Text("Incorrect PIN") }
                    } else null,
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    if (pin == UNLOCK_PIN) {
                        onUnlock()
                    } else {
                        error = true
                        pin = ""
                    }
                },
            ) {
                Text("Unlock")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        },
    )
}
