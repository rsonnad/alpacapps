package com.alpacaplayhouse.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alpacaplayhouse.app.data.AuthManager
import com.alpacaplayhouse.app.data.LightApi
import com.alpacaplayhouse.app.data.UserCapabilities
import com.alpacaplayhouse.app.ui.theme.*
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
    val requiresRoomAccess: Boolean = false, // true = only visible if assigned or admin
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
        requiresRoomAccess = true,
    ),
)

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
    var statusMessage by remember { mutableStateOf<String?>(null) }
    val isDark = isSystemInDarkTheme()

    // Check user access — admin/staff see all zones; others only see non-restricted or assigned
    val isAdmin = remember {
        val role = AuthManager.userRole
        role == "admin" || role == "staff"
    }

    // Filter zones based on access
    val visibleZones = remember(isAdmin) {
        if (isAdmin) ZONES else ZONES.filter { !it.requiresRoomAccess }
    }

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
            .padding(horizontal = 20.dp, vertical = 12.dp),
    ) {
        Text(
            text = "Lights",
            fontSize = 26.sp,
            fontWeight = FontWeight.Bold,
            color = if (isDark) Color.White else AlpacaText,
        )

        Spacer(modifier = Modifier.height(8.dp))

        statusMessage?.let { msg ->
            Text(
                text = msg,
                fontSize = 13.sp,
                color = AlpacaPrimary,
                modifier = Modifier.padding(bottom = 8.dp),
            )
        }

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(14.dp),
            contentPadding = PaddingValues(bottom = 16.dp),
        ) {
            items(visibleZones) { zone ->
                ZoneCard(
                    zone = zone,
                    isDark = isDark,
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
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ZoneCard(
    zone: LightZone,
    isDark: Boolean,
    onSceneTap: (LightScene) -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = if (isDark) AlpacaDarkSurface else Color.White,
        ),
        shape = RoundedCornerShape(14.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = if (isDark) 0.dp else 1.dp),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text = zone.name,
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
                color = if (isDark) Color.White else AlpacaText,
            )

            Text(
                text = zone.rooms.joinToString(" / "),
                fontSize = 12.sp,
                color = AlpacaMuted,
            )

            Spacer(modifier = Modifier.height(12.dp))

            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                zone.scenes.forEach { scene ->
                    SceneButton(
                        scene = scene,
                        isDark = isDark,
                        onClick = { onSceneTap(scene) },
                    )
                }
            }
        }
    }
}

@Composable
private fun SceneButton(
    scene: LightScene,
    isDark: Boolean,
    onClick: () -> Unit,
) {
    val accent = sceneAccentColor(scene)
    val isOff = scene.label == "Off"

    FilledTonalButton(
        onClick = onClick,
        shape = RoundedCornerShape(10.dp),
        colors = ButtonDefaults.filledTonalButtonColors(
            containerColor = if (isOff) {
                if (isDark) Color(0xFF2A2D35) else Color(0xFFF1F5F9)
            } else {
                accent.copy(alpha = if (isDark) 0.3f else 0.2f)
            },
            contentColor = if (isOff) {
                AlpacaMuted
            } else {
                if (isDark) Color.White else AlpacaText
            },
        ),
    ) {
        Text(scene.label, fontSize = 13.sp, fontWeight = FontWeight.Medium)
    }
}
