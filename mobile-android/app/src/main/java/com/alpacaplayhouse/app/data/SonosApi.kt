package com.alpacaplayhouse.app.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

@Serializable
data class SonosState(
    val currentTrack: SonosTrack? = null,
    val playbackState: String = "STOPPED",
    val volume: Int = 0,
)

@Serializable
data class SonosTrack(
    val artist: String = "",
    val title: String = "",
    val albumArtUri: String? = null,
)

object SonosApi {
    private val client = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build()

    private val json = Json { ignoreUnknownKeys = true }

    private fun encodeRoom(room: String): String =
        URLEncoder.encode(room, "UTF-8")

    suspend fun getState(room: String): Result<SonosState> = withContext(Dispatchers.IO) {
        runCatching {
            val url = "${ApiConfig.SONOS_BASE_URL}/${encodeRoom(room)}/state"
            val request = Request.Builder().url(url).get().build()
            val response = client.newCall(request).execute()
            val body = response.body?.string() ?: "{}"
            json.decodeFromString<SonosState>(body)
        }
    }

    suspend fun playPlaylist(room: String, playlistName: String): Result<String> = withContext(Dispatchers.IO) {
        runCatching {
            val encodedPlaylist = URLEncoder.encode(playlistName, "UTF-8")
            val url = "${ApiConfig.SONOS_BASE_URL}/${encodeRoom(room)}/playlist/$encodedPlaylist"
            val request = Request.Builder().url(url).get().build()
            val response = client.newCall(request).execute()
            response.body?.string() ?: ""
        }
    }

    suspend fun playPause(room: String): Result<String> = withContext(Dispatchers.IO) {
        runCatching {
            val url = "${ApiConfig.SONOS_BASE_URL}/${encodeRoom(room)}/playpause"
            val request = Request.Builder().url(url).get().build()
            val response = client.newCall(request).execute()
            response.body?.string() ?: ""
        }
    }

    suspend fun stop(room: String): Result<String> = withContext(Dispatchers.IO) {
        runCatching {
            val url = "${ApiConfig.SONOS_BASE_URL}/${encodeRoom(room)}/pause"
            val request = Request.Builder().url(url).get().build()
            val response = client.newCall(request).execute()
            response.body?.string() ?: ""
        }
    }

    suspend fun setVolume(room: String, level: Int): Result<String> = withContext(Dispatchers.IO) {
        runCatching {
            val url = "${ApiConfig.SONOS_BASE_URL}/${encodeRoom(room)}/volume/$level"
            val request = Request.Builder().url(url).get().build()
            val response = client.newCall(request).execute()
            response.body?.string() ?: ""
        }
    }
}
