package com.alpacaplayhouse.app.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

data class ConversationResponse(
    val speech: String,
    val conversationId: String?,
)

object HaosApi {
    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()

    /**
     * Send a message to the Home Assistant Conversation API.
     * @param text The user's message text
     * @param conversationId Optional conversation ID for multi-turn conversations
     * @return ConversationResponse with the assistant's reply and conversation ID
     */
    suspend fun sendMessage(
        text: String,
        conversationId: String? = null,
    ): Result<ConversationResponse> = withContext(Dispatchers.IO) {
        runCatching {
            val jsonBody = JSONObject().apply {
                put("text", text)
                put("language", "en")
                if (conversationId != null) {
                    put("conversation_id", conversationId)
                }
            }
            val body = jsonBody.toString().toRequestBody(JSON_MEDIA)
            val url = "${ApiConfig.HAOS_BASE_URL}/api/conversation/process"
            val request = Request.Builder()
                .url(url)
                .addHeader("Authorization", "Bearer ${ApiConfig.HAOS_TOKEN}")
                .addHeader("Content-Type", "application/json")
                .post(body)
                .build()
            val response = client.newCall(request).execute()
            val responseBody = response.body?.string()
                ?: throw Exception("Empty response from HAOS")

            if (!response.isSuccessful) {
                throw Exception("HAOS error ${response.code}: $responseBody")
            }

            val json = JSONObject(responseBody)
            val responseObj = json.getJSONObject("response")
            val speechObj = responseObj.getJSONObject("speech")
                .getJSONObject("plain")
            val speechText = speechObj.getString("speech")
            val convId = json.optString("conversation_id", null)

            ConversationResponse(
                speech = speechText,
                conversationId = convId,
            )
        }
    }
}
