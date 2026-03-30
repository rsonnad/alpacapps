package com.alpacaplayhouse.app.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import com.alpacaplayhouse.app.ui.theme.LocalIsDarkTheme
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
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
    val isDark = LocalIsDarkTheme.current

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

    // Gradient header brush
    val headerGradient = Brush.verticalGradient(
        colors = listOf(
            AlpacaPrimary.copy(alpha = 0.3f),
            Color.Transparent,
        ),
    )

    Column(
        modifier = Modifier.fillMaxSize(),
    ) {
        // --- Gradient header section ---
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .background(headerGradient)
                .padding(horizontal = 20.dp, vertical = 20.dp),
        ) {
            Column {
                Text(
                    text = "Lights",
                    fontSize = 30.sp,
                    fontWeight = FontWeight.ExtraBold,
                    color = if (isDark) Color.White else AlpacaText,
                    letterSpacing = (-0.5).sp,
                )

                statusMessage?.let { msg ->
                    Spacer(modifier = Modifier.height(10.dp))
                    Surface(
                        shape = RoundedCornerShape(20.dp),
                        color = if (isDark) {
                            AlpacaDarkSurface.copy(alpha = 0.6f)
                        } else {
                            Color.White.copy(alpha = 0.85f)
                        },
                        border = BorderStroke(
                            0.5.dp,
                            if (isDark) AlpacaLuxe.glassBorder else AlpacaLuxe.glassBorderLightMode,
                        ),
                    ) {
                        Text(
                            text = msg,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Medium,
                            color = AlpacaPrimary,
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
                        )
                    }
                }
            }
        }

        // --- Zone list ---
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
            contentPadding = PaddingValues(top = 8.dp, bottom = 16.dp),
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
    val glassBorder = if (isDark) AlpacaLuxe.glassBorder else AlpacaLuxe.glassBorderLightMode

    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(AlpacaLuxe.cardRadius.dp),
        color = if (isDark) {
            AlpacaDarkSurface.copy(alpha = 0.6f)
        } else {
            Color.White.copy(alpha = 0.85f)
        },
        border = BorderStroke(0.5.dp, glassBorder),
        tonalElevation = 0.dp,
        shadowElevation = if (isDark) 0.dp else 2.dp,
    ) {
        Column(modifier = Modifier.padding(18.dp)) {
            Text(
                text = zone.name,
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold,
                color = if (isDark) Color.White else AlpacaText,
                letterSpacing = (-0.3).sp,
            )

            Spacer(modifier = Modifier.height(2.dp))

            Text(
                text = zone.rooms.joinToString(" / "),
                fontSize = 12.sp,
                color = AlpacaMuted,
            )

            Spacer(modifier = Modifier.height(14.dp))

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

    val buttonShape = RoundedCornerShape(AlpacaLuxe.chipRadius.dp)

    // Colored shadow glow for non-Off scenes
    val glowModifier = if (!isOff) {
        Modifier.shadow(
            elevation = 6.dp,
            shape = buttonShape,
            ambientColor = accent.copy(alpha = 0.4f),
            spotColor = accent.copy(alpha = 0.35f),
        )
    } else {
        Modifier
    }

    FilledTonalButton(
        onClick = onClick,
        modifier = glowModifier,
        shape = buttonShape,
        colors = ButtonDefaults.filledTonalButtonColors(
            containerColor = if (isOff) {
                if (isDark) Color(0xFF1E2028) else Color(0xFFECEFF1)
            } else {
                accent.copy(alpha = if (isDark) 0.3f else 0.2f)
            },
            contentColor = if (isOff) {
                AlpacaMuted.copy(alpha = 0.7f)
            } else {
                if (isDark) Color.White else AlpacaText
            },
        ),
    ) {
        Text(scene.label, fontSize = 13.sp, fontWeight = FontWeight.Medium)
    }
}
