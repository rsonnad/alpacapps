package com.alpacaplayhouse.app.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

object LightApi {
    private val client = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build()

    private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()

    /**
     * Control lights via the WiZ proxy.
     * @param rooms Comma-separated room names (e.g. "living,kitchen")
     * @param color Color name (e.g. "white", "warm", "magenta", "amber", "off")
     * @param brightness Brightness string (e.g. "100%", "80%", "30%")
     */
    suspend fun controlLights(
        rooms: String,
        color: String,
        brightness: String,
    ): Result<String> = withContext(Dispatchers.IO) {
        runCatching {
            val jsonBody = JSONObject().apply {
                put("rooms", rooms)
                put("color", color)
                put("brightness", brightness)
            }
            val body = jsonBody.toString().toRequestBody(JSON_MEDIA)
            val url = "${ApiConfig.LIGHTS_BASE_URL}/lights"
            val request = Request.Builder()
                .url(url)
                .post(body)
                .build()
            val response = client.newCall(request).execute()
            response.body?.string() ?: ""
        }
    }
}
