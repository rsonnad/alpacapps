package com.alpacaplayhouse.kiosk

import java.io.DataOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

/**
 * Handles uploading photos to Supabase Storage and inserting guest book entries.
 * Uses raw HTTP to avoid heavy SDK dependencies for simple operations.
 */
class GuestBookManager(
    private val supabaseUrl: String,
    private val supabaseKey: String
) {

    private val storageBucket = "housephotos"

    fun uploadPhoto(jpegBytes: ByteArray, path: String) {
        val url = URL("$supabaseUrl/storage/v1/object/$storageBucket/$path")
        val conn = url.openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.setRequestProperty("Authorization", "Bearer $supabaseKey")
        conn.setRequestProperty("apikey", supabaseKey)
        conn.setRequestProperty("Content-Type", "image/jpeg")
        conn.setRequestProperty("x-upsert", "true")
        conn.doOutput = true

        DataOutputStream(conn.outputStream).use { it.write(jpegBytes) }

        val responseCode = conn.responseCode
        if (responseCode !in 200..299) {
            val error = conn.errorStream?.bufferedReader()?.readText() ?: "Unknown error"
            throw Exception("Upload failed ($responseCode): $error")
        }
        conn.disconnect()
    }

    fun insertEntry(photoPath: String, guestName: String? = null, message: String? = null) {
        val photoUrl = "$supabaseUrl/storage/v1/object/public/$storageBucket/$photoPath"
        val id = UUID.randomUUID().toString()

        val nameJson = if (guestName != null) "\"$guestName\"" else "null"
        val msgJson = if (message != null) "\"$message\"" else "null"

        val body = """
        {
            "id": "$id",
            "photo_url": "$photoUrl",
            "guest_name": $nameJson,
            "message": $msgJson
        }
        """.trimIndent()

        val url = URL("$supabaseUrl/rest/v1/guestbook_entries")
        val conn = url.openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.setRequestProperty("Authorization", "Bearer $supabaseKey")
        conn.setRequestProperty("apikey", supabaseKey)
        conn.setRequestProperty("Content-Type", "application/json")
        conn.setRequestProperty("Prefer", "return=minimal")
        conn.doOutput = true

        DataOutputStream(conn.outputStream).use { it.write(body.toByteArray()) }

        val responseCode = conn.responseCode
        if (responseCode !in 200..299) {
            val error = conn.errorStream?.bufferedReader()?.readText() ?: "Unknown error"
            throw Exception("Insert failed ($responseCode): $error")
        }
        conn.disconnect()
    }
}
