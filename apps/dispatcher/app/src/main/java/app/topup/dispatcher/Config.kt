package app.topup.dispatcher

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Everything the device is trusted with, kept where a stolen handset does not
 * hand it over.
 *
 * Two secrets live here and neither is ever sent anywhere it need not go: the
 * agent token, which the worker issues once at enrolment, and the SIM's PIN,
 * which the worker never sees at all. The job payload deliberately carries only
 * an id, a number and an amount — the PIN is substituted into the menu on this
 * side of the wire and nowhere else.
 */
class Config(context: Context) {
    private val prefs = EncryptedSharedPreferences.create(
        context,
        "dispatcher",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    var baseUrl: String
        get() = prefs.getString(BASE_URL, "") ?: ""
        set(v) = prefs.edit().putString(BASE_URL, v.trimEnd('/')).apply()

    var token: String
        get() = prefs.getString(TOKEN, "") ?: ""
        set(v) = prefs.edit().putString(TOKEN, v.trim()).apply()

    var pin: String
        get() = prefs.getString(PIN, "") ?: ""
        set(v) = prefs.edit().putString(PIN, v.trim()).apply()

    /** This SIM's own number, used only to salt a synthesized receipt reference. */
    var msisdn: String
        get() = prefs.getString(MSISDN, "") ?: ""
        set(v) = prefs.edit().putString(MSISDN, v.trim()).apply()

    /**
     * Dispatch without dialling.
     *
     * Claims jobs and reports them failed, which exercises the whole loop —
     * lease, report, settle, recheck — before a franc moves. The first thing to
     * turn on when a bench is new, and the last thing to turn off.
     */
    var dryRun: Boolean
        get() = prefs.getBoolean(DRY_RUN, true)
        set(v) = prefs.edit().putBoolean(DRY_RUN, v).apply()

    /** Last script fetched, kept so a worker blip does not stop dispatch. */
    var cachedScript: String
        get() = prefs.getString(SCRIPT, "") ?: ""
        set(v) = prefs.edit().putString(SCRIPT, v).apply()

    val provisioned: Boolean get() = baseUrl.isNotEmpty() && token.isNotEmpty()

    private companion object {
        const val BASE_URL = "baseUrl"
        const val TOKEN = "token"
        const val PIN = "pin"
        const val MSISDN = "msisdn"
        const val DRY_RUN = "dryRun"
        const val SCRIPT = "script"
    }
}
