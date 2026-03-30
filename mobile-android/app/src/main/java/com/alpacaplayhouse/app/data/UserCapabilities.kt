package com.alpacaplayhouse.app.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request

@Serializable
data class NestDevice(
    val id: Long = 0,
    val space_id: Long? = null,
    val is_active: Boolean = true,
)

@Serializable
data class Vehicle(
    val id: Long = 0,
    val make: String? = null,
    val is_active: Boolean = true,
)

@Serializable
data class AssignmentSpace(
    val space_id: Long? = null,
)

@Serializable
data class AssignmentRow(
    val id: Long = 0,
    val assignment_spaces: List<AssignmentSpace> = emptyList(),
)

data class UserCapabilities(
    val isAdmin: Boolean,
    val hasThermostat: Boolean,
    val hasTesla: Boolean,
    val assignedSpaceIds: Set<Long>,
) {
    companion object {
        private val client = OkHttpClient()
        private val json = Json { ignoreUnknownKeys = true }

        suspend fun load(): UserCapabilities = withContext(Dispatchers.IO) {
            val role = AuthManager.userRole
            val isAdmin = role == "admin" || role == "staff"

            // Admin gets everything
            if (isAdmin) {
                return@withContext UserCapabilities(
                    isAdmin = true,
                    hasThermostat = true,
                    hasTesla = true,
                    assignedSpaceIds = emptySet(),
                )
            }

            val token = AuthManager.accessToken ?: ApiConfig.SUPABASE_ANON_KEY
            val userId = AuthManager.userId

            // Check assigned spaces via assignments + assignment_spaces
            val assignedSpaceIds = mutableSetOf<Long>()
            if (userId != null) {
                try {
                    val req = Request.Builder()
                        .url("${ApiConfig.SUPABASE_URL}/rest/v1/assignments?select=id,assignment_spaces(space_id)&person_id=eq.$userId&status=in.(active,pending_contract,contract_sent)")
                        .addHeader("apikey", ApiConfig.SUPABASE_ANON_KEY)
                        .addHeader("Authorization", "Bearer $token")
                        .build()
                    val resp = client.newCall(req).execute()
                    val body = resp.body?.string() ?: "[]"
                    val assignments = json.decodeFromString<List<AssignmentRow>>(body)
                    assignments.forEach { a ->
                        a.assignment_spaces.forEach { s ->
                            s.space_id?.let { assignedSpaceIds.add(it) }
                        }
                    }
                } catch (_: Exception) { }
            }

            // Check if any assigned space has a thermostat (nest_devices)
            var hasThermostat = false
            if (assignedSpaceIds.isNotEmpty()) {
                try {
                    val spaceFilter = assignedSpaceIds.joinToString(",")
                    val req = Request.Builder()
                        .url("${ApiConfig.SUPABASE_URL}/rest/v1/nest_devices?select=id&is_active=eq.true&space_id=in.($spaceFilter)&limit=1")
                        .addHeader("apikey", ApiConfig.SUPABASE_ANON_KEY)
                        .addHeader("Authorization", "Bearer $token")
                        .build()
                    val resp = client.newCall(req).execute()
                    val body = resp.body?.string() ?: "[]"
                    hasThermostat = body != "[]"
                } catch (_: Exception) { }
            }

            // Check if user has a Tesla (vehicles table)
            var hasTesla = false
            try {
                val req = Request.Builder()
                    .url("${ApiConfig.SUPABASE_URL}/rest/v1/vehicles?select=id&is_active=eq.true&make=ilike.tesla&limit=1")
                    .addHeader("apikey", ApiConfig.SUPABASE_ANON_KEY)
                    .addHeader("Authorization", "Bearer $token")
                    .build()
                val resp = client.newCall(req).execute()
                val body = resp.body?.string() ?: "[]"
                hasTesla = body != "[]"
            } catch (_: Exception) { }

            UserCapabilities(
                isAdmin = false,
                hasThermostat = hasThermostat,
                hasTesla = hasTesla,
                assignedSpaceIds = assignedSpaceIds,
            )
        }
    }
}
