package com.alpacaplayhouse.app.navigation

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DirectionsCar
import androidx.compose.material.icons.filled.Lightbulb
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.SmartToy
import androidx.compose.material.icons.filled.Thermostat
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.alpacaplayhouse.app.ui.screens.*
import kotlinx.serialization.Serializable

// Type-safe route definitions
@Serializable object AssistantRoute
@Serializable object MusicRoute
@Serializable object LightsRoute
@Serializable object ClimateRoute
@Serializable object CarsRoute

data class TabItem(
    val label: String,
    val icon: ImageVector,
    val route: Any,
)

val tabs = listOf(
    TabItem("Assistant", Icons.Default.SmartToy, AssistantRoute),
    TabItem("Music", Icons.Default.MusicNote, MusicRoute),
    TabItem("Lights", Icons.Default.Lightbulb, LightsRoute),
    TabItem("Climate", Icons.Default.Thermostat, ClimateRoute),
    TabItem("Cars", Icons.Default.DirectionsCar, CarsRoute),
)

@Composable
fun AppNavigation() {
    val navController = rememberNavController()
    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentDestination = navBackStackEntry?.destination

    Scaffold(
        bottomBar = {
            NavigationBar {
                tabs.forEach { tab ->
                    NavigationBarItem(
                        selected = currentDestination?.hasRoute(tab.route::class) == true,
                        onClick = {
                            navController.navigate(tab.route) {
                                popUpTo(navController.graph.findStartDestination().id) {
                                    saveState = true
                                }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        icon = { Icon(tab.icon, contentDescription = tab.label) },
                        label = { Text(tab.label) }
                    )
                }
            }
        }
    ) { innerPadding ->
        NavHost(
            navController = navController,
            startDestination = AssistantRoute,
            modifier = Modifier.padding(innerPadding)
        ) {
            composable<AssistantRoute> { AssistantScreen() }
            composable<MusicRoute> { MusicScreen() }
            composable<LightsRoute> { LightsScreen() }
            composable<ClimateRoute> { ClimateScreen() }
            composable<CarsRoute> { CarsScreen() }
        }
    }
}
