package com.alpacaplayhouse.app.navigation

import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DirectionsCar
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Lightbulb
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Thermostat
import androidx.compose.material.icons.filled.Work
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
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

data class TabItem(
    val label: String,
    val icon: ImageVector,
    val route: Any,
)

val tabs = listOf(
    TabItem("Home", Icons.Default.Home, AssistantRoute),
    TabItem("Music", Icons.Default.MusicNote, MusicRoute),
    TabItem("Lights", Icons.Default.Lightbulb, LightsRoute),
    TabItem("Work", Icons.Default.Work, WorkRoute),
    TabItem("Climate", Icons.Default.Thermostat, ClimateRoute),
    TabItem("Cars", Icons.Default.DirectionsCar, CarsRoute),
)

@Composable
fun AppNavigation() {
    val navController = rememberNavController()
    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentDestination = navBackStackEntry?.destination
    val isDark = isSystemInDarkTheme()

    Scaffold(
        topBar = {
            // Branded top bar
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(if (isDark) AlpacaDarkBg else Color.White)
                    .statusBarsPadding()
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                contentAlignment = Alignment.Center,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    AsyncImage(
                        model = if (isDark) ApiConfig.LOGO_DARK_URL else ApiConfig.LOGO_LIGHT_URL,
                        contentDescription = "Alpaca Playhouse",
                        modifier = Modifier.size(28.dp),
                        contentScale = ContentScale.Fit,
                    )
                    Spacer(modifier = Modifier.width(10.dp))
                    // Text fallback always visible (even if image fails)
                    Text(
                        text = "Alpaca Playhouse",
                        fontSize = 17.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = if (isDark) Color.White else AlpacaText,
                        letterSpacing = (-0.3).sp,
                    )
                }
            }
        },
        bottomBar = {
            NavigationBar(
                containerColor = if (isDark) AlpacaDarkSurface else Color.White,
                tonalElevation = 0.dp,
            ) {
                tabs.forEach { tab ->
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
                            indicatorColor = AlpacaPrimary.copy(alpha = 0.12f),
                        ),
                    )
                }
            }
        },
    ) { innerPadding ->
        NavHost(
            navController = navController,
            startDestination = AssistantRoute,
            modifier = Modifier.padding(innerPadding),
        ) {
            composable<AssistantRoute> { AssistantScreen() }
            composable<MusicRoute> { MusicScreen() }
            composable<LightsRoute> { LightsScreen() }
            composable<WorkRoute> { WorkScreen() }
            composable<ClimateRoute> { ClimateScreen() }
            composable<CarsRoute> { CarsScreen() }
        }
    }
}
