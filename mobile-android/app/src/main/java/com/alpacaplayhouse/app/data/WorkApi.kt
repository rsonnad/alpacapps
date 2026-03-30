package com.alpacaplayhouse.app.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

@Serializable
data class WorkTask(
    val id: Long = 0,
    val title: String = "",
    val description: String? = null,
    val status: String = "open",
    val priority: String = "medium",
    val assignee_id: String? = null,
    val space_id: Long? = null,
    val created_at: String? = null,
)

@Serializable
data class HoursEntry(
    val id: Long = 0,
    val user_id: String = "",
    val clock_in: String? = null,
    val clock_out: String? = null,
    val total_hours: Double? = null,
    val notes: String? = null,
    val status: String = "active",
    val created_at: String? = null,
)

@Serializable
data class ProjectInquiry(
    val id: Long = 0,
    val question: String = "",
    val answer: String? = null,
    val status: String = "pending",
    val created_at: String? = null,
    val user_id: String? = null,
)

object WorkApi {
    private val client = OkHttpClient()
    private val json = Json { ignoreUnknownKeys = true }

    private fun authRequest(path: String): Request.Builder {
        val token = AuthManager.accessToken ?: ApiConfig.SUPABASE_ANON_KEY
        return Request.Builder()
            .url("${ApiConfig.SUPABASE_URL}/rest/v1/$path")
            .addHeader("apikey", ApiConfig.SUPABASE_ANON_KEY)
            .addHeader("Authorization", "Bearer $token")
    }

    // --- Tasks ---

    suspend fun getTasks(status: String? = null): Result<List<WorkTask>> = withContext(Dispatchers.IO) {
        try {
            val filter = if (status != null) "&status=eq.$status" else ""
            val req = authRequest("tasks?select=*&order=created_at.desc$filter")
                .build()
            val resp = client.newCall(req).execute()
            val body = resp.body?.string() ?: "[]"
            Result.success(json.decodeFromString<List<WorkTask>>(body))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun createTask(title: String, description: String?, priority: String = "medium"): Result<WorkTask> =
        withContext(Dispatchers.IO) {
            try {
                val payload = buildString {
                    append("""{"title":"$title","priority":"$priority","status":"open"""")
                    if (description != null) append(""","description":"$description"""")
                    append("}")
                }
                val req = authRequest("tasks")
                    .addHeader("Content-Type", "application/json")
                    .addHeader("Prefer", "return=representation")
                    .post(payload.toRequestBody("application/json".toMediaType()))
                    .build()
                val resp = client.newCall(req).execute()
                val body = resp.body?.string() ?: "[]"
                val tasks = json.decodeFromString<List<WorkTask>>(body)
                Result.success(tasks.first())
            } catch (e: Exception) {
                Result.failure(e)
            }
        }

    suspend fun updateTaskStatus(taskId: Long, status: String): Result<Unit> =
        withContext(Dispatchers.IO) {
            try {
                val payload = """{"status":"$status"}"""
                val req = authRequest("tasks?id=eq.$taskId")
                    .addHeader("Content-Type", "application/json")
                    .patch(payload.toRequestBody("application/json".toMediaType()))
                    .build()
                client.newCall(req).execute()
                Result.success(Unit)
            } catch (e: Exception) {
                Result.failure(e)
            }
        }

    // --- Hours ---

    suspend fun getHours(): Result<List<HoursEntry>> = withContext(Dispatchers.IO) {
        try {
            val req = authRequest("hours_entries?select=*&order=created_at.desc&limit=50")
                .build()
            val resp = client.newCall(req).execute()
            val body = resp.body?.string() ?: "[]"
            Result.success(json.decodeFromString<List<HoursEntry>>(body))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun clockIn(notes: String? = null): Result<HoursEntry> = withContext(Dispatchers.IO) {
        try {
            val payload = buildString {
                append("""{"status":"active","clock_in":"now()"""")
                if (notes != null) append(""","notes":"$notes"""")
                append("}")
            }
            val req = authRequest("hours_entries")
                .addHeader("Content-Type", "application/json")
                .addHeader("Prefer", "return=representation")
                .post(payload.toRequestBody("application/json".toMediaType()))
                .build()
            val resp = client.newCall(req).execute()
            val body = resp.body?.string() ?: "[]"
            val entries = json.decodeFromString<List<HoursEntry>>(body)
            Result.success(entries.first())
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    // --- Inquiries ---

    suspend fun getInquiries(): Result<List<ProjectInquiry>> = withContext(Dispatchers.IO) {
        try {
            val req = authRequest("project_inquiries?select=*&order=created_at.desc&limit=50")
                .build()
            val resp = client.newCall(req).execute()
            val body = resp.body?.string() ?: "[]"
            Result.success(json.decodeFromString<List<ProjectInquiry>>(body))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun createInquiry(question: String): Result<ProjectInquiry> =
        withContext(Dispatchers.IO) {
            try {
                val payload = """{"question":"$question","status":"pending"}"""
                val req = authRequest("project_inquiries")
                    .addHeader("Content-Type", "application/json")
                    .addHeader("Prefer", "return=representation")
                    .post(payload.toRequestBody("application/json".toMediaType()))
                    .build()
                val resp = client.newCall(req).execute()
                val body = resp.body?.string() ?: "[]"
                val items = json.decodeFromString<List<ProjectInquiry>>(body)
                Result.success(items.first())
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
}
