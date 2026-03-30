package com.alpacaplayhouse.app.data

import android.content.Context
import android.content.SharedPreferences
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

@Serializable
data class AuthUser(
    val id: String,
    val email: String? = null,
    val user_metadata: UserMetadata? = null,
)

@Serializable
data class UserMetadata(
    val full_name: String? = null,
    val avatar_url: String? = null,
    val name: String? = null,
)

@Serializable
data class AuthSession(
    val access_token: String,
    val refresh_token: String,
    val expires_in: Long = 3600,
    val user: AuthUser,
)

@Serializable
data class AppUserRow(
    val id: String? = null,
    val role: String? = null,
    val email: String? = null,
    val display_name: String? = null,
)

object AuthManager {
    private val client = OkHttpClient()
    private val json = Json { ignoreUnknownKeys = true }
    private const val PREFS_NAME = "alpaca_auth"
    private const val KEY_ACCESS_TOKEN = "access_token"
    private const val KEY_REFRESH_TOKEN = "refresh_token"
    private const val KEY_USER_EMAIL = "user_email"
    private const val KEY_USER_NAME = "user_name"
    private const val KEY_USER_AVATAR = "user_avatar"
    private const val KEY_USER_ID = "user_id"
    private const val KEY_USER_ROLE = "user_role"

    private var prefs: SharedPreferences? = null

    fun init(context: Context) {
        prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    fun getGoogleOAuthUrl(): String {
        return "${ApiConfig.SUPABASE_URL}/auth/v1/authorize" +
            "?provider=google" +
            "&redirect_to=${Uri.encode(ApiConfig.OAUTH_REDIRECT_URL)}"
    }

    val isLoggedIn: Boolean
        get() = prefs?.getString(KEY_ACCESS_TOKEN, null) != null

    val accessToken: String?
        get() = prefs?.getString(KEY_ACCESS_TOKEN, null)

    val userId: String?
        get() = prefs?.getString(KEY_USER_ID, null)

    val userName: String?
        get() = prefs?.getString(KEY_USER_NAME, null)

    val userEmail: String?
        get() = prefs?.getString(KEY_USER_EMAIL, null)

    val userAvatar: String?
        get() = prefs?.getString(KEY_USER_AVATAR, null)

    val userRole: String?
        get() = prefs?.getString(KEY_USER_ROLE, null)

    suspend fun handleOAuthCallback(uri: Uri): Result<AuthSession> = withContext(Dispatchers.IO) {
        try {
            // Supabase redirects with fragment: #access_token=...&refresh_token=...
            val fragment = uri.fragment ?: return@withContext Result.failure(Exception("No auth fragment"))
            val params = fragment.split("&").associate {
                val (k, v) = it.split("=", limit = 2)
                k to Uri.decode(v)
            }

            val accessToken = params["access_token"]
                ?: return@withContext Result.failure(Exception("No access token"))
            val refreshToken = params["refresh_token"] ?: ""

            // Fetch user info
            val req = Request.Builder()
                .url("${ApiConfig.SUPABASE_URL}/auth/v1/user")
                .addHeader("Authorization", "Bearer $accessToken")
                .addHeader("apikey", ApiConfig.SUPABASE_ANON_KEY)
                .build()

            val resp = client.newCall(req).execute()
            val body = resp.body?.string() ?: "{}"
            val user = json.decodeFromString<AuthUser>(body)

            val session = AuthSession(
                access_token = accessToken,
                refresh_token = refreshToken,
                user = user,
            )

            saveSession(session)
            fetchAndSaveRole(accessToken, user.id)

            Result.success(session)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    private suspend fun fetchAndSaveRole(token: String, userId: String) {
        try {
            val req = Request.Builder()
                .url("${ApiConfig.SUPABASE_URL}/rest/v1/app_users?id=eq.$userId&select=role")
                .addHeader("Authorization", "Bearer $token")
                .addHeader("apikey", ApiConfig.SUPABASE_ANON_KEY)
                .build()
            val resp = client.newCall(req).execute()
            val body = resp.body?.string() ?: "[]"
            val users = json.decodeFromString<List<AppUserRow>>(body)
            users.firstOrNull()?.role?.let { role ->
                prefs?.edit()?.putString(KEY_USER_ROLE, role)?.apply()
            }
        } catch (_: Exception) { }
    }

    private fun saveSession(session: AuthSession) {
        prefs?.edit()?.apply {
            putString(KEY_ACCESS_TOKEN, session.access_token)
            putString(KEY_REFRESH_TOKEN, session.refresh_token)
            putString(KEY_USER_ID, session.user.id)
            putString(KEY_USER_EMAIL, session.user.email)
            putString(KEY_USER_NAME,
                session.user.user_metadata?.full_name
                    ?: session.user.user_metadata?.name
                    ?: session.user.email
            )
            putString(KEY_USER_AVATAR, session.user.user_metadata?.avatar_url)
            apply()
        }
    }

    fun logout() {
        prefs?.edit()?.clear()?.apply()
    }

    suspend fun refreshSession(): Boolean = withContext(Dispatchers.IO) {
        val refreshToken = prefs?.getString(KEY_REFRESH_TOKEN, null) ?: return@withContext false
        try {
            val jsonBody = """{"refresh_token":"$refreshToken"}"""
            val req = Request.Builder()
                .url("${ApiConfig.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token")
                .addHeader("apikey", ApiConfig.SUPABASE_ANON_KEY)
                .addHeader("Content-Type", "application/json")
                .post(jsonBody.toRequestBody("application/json".toMediaType()))
                .build()
            val resp = client.newCall(req).execute()
            if (!resp.isSuccessful) return@withContext false
            val body = resp.body?.string() ?: return@withContext false
            val session = json.decodeFromString<AuthSession>(body)
            saveSession(session)
            true
        } catch (_: Exception) {
            false
        }
    }
}
