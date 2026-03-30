package com.alpacaplayhouse.app.navigation

import androidx.compose.foundation.background
import com.alpacaplayhouse.app.ui.theme.LocalIsDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DirectionsCar
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Lightbulb
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Subtitles
import androidx.compose.material.icons.filled.Thermostat
import androidx.compose.material.icons.filled.Work
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import coil3.compose.AsyncImage
import com.alpacaplayhouse.app.data.ApiConfig
import com.alpacaplayhouse.app.data.AuthManager
import com.alpacaplayhouse.app.data.UserCapabilities
import com.alpacaplayhouse.app.ui.screens.*
import com.alpacaplayhouse.app.ui.theme.*
import kotlinx.serialization.Serializable

// Type-safe route definitions
@Serializable object AssistantRoute
@Serializable object MusicRoute
@Serializable object LightsRoute
@Serializable object ClimateRoute
@Serializable object CarsRoute
@Serializable object WorkRoute
@Serializable object SubtitleRoute

data class TabItem(
    val label: String,
    val icon: ImageVector,
    val route: Any,
    val key: String,
)

// All possible tabs
private val allTabs = listOf(
    TabItem("Home", Icons.Default.Home, AssistantRoute, "home"),
    TabItem("Music", Icons.Default.MusicNote, MusicRoute, "music"),
    TabItem("Lights", Icons.Default.Lightbulb, LightsRoute, "lights"),
    TabItem("Subtitles", Icons.Default.Subtitles, SubtitleRoute, "subtitles"),
    TabItem("Work", Icons.Default.Work, WorkRoute, "work"),
    TabItem("Climate", Icons.Default.Thermostat, ClimateRoute, "climate"),
    TabItem("Cars", Icons.Default.DirectionsCar, CarsRoute, "cars"),
)

@Composable
fun AppNavigation() {
    val navController = rememberNavController()
    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentDestination = navBackStackEntry?.destination
    val isDark = LocalIsDarkTheme.current

    // Load user capabilities to determine which tabs to show
    var capabilities by remember { mutableStateOf<UserCapabilities?>(null) }
    LaunchedEffect(Unit) {
        capabilities = UserCapabilities.load()
    }

    // Filter tabs based on capabilities
    val visibleTabs = remember(capabilities) {
        val caps = capabilities ?: return@remember allTabs.filter { it.key in listOf("home", "music", "lights", "subtitles", "work") }
        if (caps.isAdmin) {
            allTabs // Admin sees everything
        } else {
            allTabs.filter { tab ->
                when (tab.key) {
                    "home", "music", "lights", "subtitles", "work" -> true // Always visible
                    "climate" -> caps.hasThermostat
                    "cars" -> caps.hasTesla
                    else -> false
                }
            }
        }
    }

    Scaffold(
        topBar = {
            // Branded top bar with gradient
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(
                        if (isDark) AlpacaLuxe.headerGradientDark
                        else AlpacaLuxe.headerGradientLight
                    )
                    .statusBarsPadding()
                    .padding(horizontal = 16.dp, vertical = 14.dp),
                contentAlignment = Alignment.Center,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    AsyncImage(
                        model = if (isDark) ApiConfig.LOGO_DARK_URL else ApiConfig.LOGO_LIGHT_URL,
                        contentDescription = "Alpaca Playhouse",
                        modifier = Modifier.size(44.dp),
                        contentScale = ContentScale.Fit,
                    )
                    Spacer(modifier = Modifier.width(12.dp))
                    Text(
                        text = "Alpaca Playhouse",
                        fontSize = 20.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (isDark) Color.White else AlpacaText,
                        letterSpacing = (-0.3).sp,
                    )
                }
            }
        },
        bottomBar = {
            NavigationBar(
                containerColor = if (isDark) AlpacaLuxe.navBarDark else AlpacaLuxe.navBarLight,
                tonalElevation = 0.dp,
            ) {
                visibleTabs.forEach { tab ->
                    val selected = currentDestination?.hasRoute(tab.route::class) == true
                    NavigationBarItem(
                        selected = selected,
                        onClick = {
                            navController.navigate(tab.route) {
                                popUpTo(navController.graph.findStartDestination().id) {
                                    saveState = true
                                }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        icon = {
                            Icon(
                                tab.icon,
                                contentDescription = tab.label,
                                modifier = Modifier.size(22.dp),
                            )
                        },
                        label = {
                            Text(
                                tab.label,
                                fontSize = 10.sp,
                                maxLines = 1,
                                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                            )
                        },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = AlpacaPrimary,
                            selectedTextColor = AlpacaPrimary,
                            unselectedIconColor = AlpacaMuted,
                            unselectedTextColor = AlpacaMuted,
                            indicatorColor = AlpacaLuxe.navIndicator,
                        ),
                    )
                }
            }
        },
    ) { innerPadding ->
        NavHost(
            navController = navController,
            startDestination = SubtitleRoute,
            modifier = Modifier.padding(innerPadding),
        ) {
            composable<AssistantRoute> { AssistantScreen() }
            composable<MusicRoute> { MusicScreen() }
            composable<LightsRoute> { LightsScreen() }
            composable<SubtitleRoute> { SubtitleScreen() }
            composable<WorkRoute> { WorkScreen() }
            composable<ClimateRoute> { ClimateScreen() }
            composable<CarsRoute> { CarsScreen() }
        }
    }
}
