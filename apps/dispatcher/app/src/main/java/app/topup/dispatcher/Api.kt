package app.topup.dispatcher

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * The worker, over three calls.
 *
 * Deliberately hand-rolled: this app has one server, three endpoints and no
 * need for a dependency that has to be kept current on a device nobody will
 * remember to update.
 */
class Api(private val config: Config) {

    /** A job to run, or null when the queue is empty. */
    suspend fun claim(balance: Int?): Job? = withContext(Dispatchers.IO) {
        val body = JSONObject().apply { if (balance != null) put("balance", balance) }
        val (code, text) = post("/agent/claim", body.toString())
        // 204 is "nothing to do" and is the common case; anything else with no
        // body is a problem worth surfacing rather than swallowing.
        if (code == 204) return@withContext null
        if (code != 200) throw ApiException(code, text)
        val o = JSONObject(text)
        Job(o.getString("jobId"), o.getString("msisdn"), o.getInt("amount"), o.getString("carrier"))
    }

    suspend fun report(jobId: String, outcome: Outcome, balance: Int?) = withContext(Dispatchers.IO) {
        val body = JSONObject().apply {
            put("jobId", jobId)
            when (outcome) {
                is Outcome.Sent -> {
                    put("status", "sent"); put("providerRef", outcome.providerRef); put("raw", outcome.raw)
                }
                is Outcome.Failed -> {
                    put("status", "failed"); put("reason", outcome.reason)
                }
                is Outcome.Unknown -> {
                    put("status", "unknown"); put("reason", outcome.reason)
                    outcome.raw?.let { put("raw", it) }
                }
            }
            if (balance != null) put("balance", balance)
        }
        val (code, text) = post("/agent/report", body.toString())
        if (code !in 200..299) throw ApiException(code, text)
    }

    /** The menu for this device's route, or the cached one if the worker is unreachable. */
    suspend fun script(): Script = withContext(Dispatchers.IO) {
        try {
            val (code, text) = get("/agent/script")
            if (code != 200) throw ApiException(code, text)
            config.cachedScript = text
            Script.parse(text)
        } catch (e: Exception) {
            val cached = config.cachedScript
            if (cached.isEmpty()) throw e
            Script.parse(cached)
        }
    }

    private fun open(path: String, method: String): HttpURLConnection =
        (URL(config.baseUrl + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            setRequestProperty("authorization", "Bearer ${config.token}")
            setRequestProperty("content-type", "application/json")
            connectTimeout = 15_000
            readTimeout = 30_000
        }

    private fun post(path: String, json: String): Pair<Int, String> {
        val conn = open(path, "POST").apply { doOutput = true }
        conn.outputStream.use { it.write(json.toByteArray()) }
        return conn.code() to conn.bodyText()
    }

    private fun get(path: String): Pair<Int, String> {
        val conn = open(path, "GET")
        return conn.code() to conn.bodyText()
    }

    private fun HttpURLConnection.code(): Int = responseCode

    private fun HttpURLConnection.bodyText(): String =
        try {
            (if (responseCode in 200..299) inputStream else errorStream)?.bufferedReader()?.readText() ?: ""
        } catch (e: Exception) {
            ""
        } finally {
            disconnect()
        }
}

class ApiException(val status: Int, val body: String) : Exception("http_$status: $body")
