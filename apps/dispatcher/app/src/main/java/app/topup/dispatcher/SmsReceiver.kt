package app.topup.dispatcher

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony

/**
 * The operator's receipt.
 *
 * The USSD dialog saying "transfert effectue" is not proof — the session can
 * report success and the transfer still fail downstream, and on these operators
 * the dialog wording is not reliable enough to bet a customer's money on. The
 * SMS is the receipt, so this is what upgrades a session from "typed
 * everything" to "the money moved".
 *
 * Messages are handed to whatever is waiting rather than parsed here, because
 * the pattern that identifies a receipt comes down with the script and changes
 * without an app release.
 */
class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        val body = messages.joinToString("") { it.displayMessageBody ?: "" }
        if (body.isBlank()) return
        val from = messages.firstOrNull()?.originatingAddress ?: ""
        Inbox.offer(Sms(from = from, body = body, atMillis = System.currentTimeMillis()))
    }
}

data class Sms(val from: String, val body: String, val atMillis: Long)

/**
 * A tiny window of recent messages.
 *
 * Not a queue to be drained: the dispatcher asks "did a receipt arrive for the
 * job I just ran", and a receipt that arrives while nothing is in flight is
 * still worth having — it is the evidence that resolves an order the worker
 * has already parked as unknown.
 */
object Inbox {
    private const val KEEP = 30
    private val recent = ArrayDeque<Sms>()

    @Synchronized fun offer(sms: Sms) {
        recent.addLast(sms)
        while (recent.size > KEEP) recent.removeFirst()
    }

    /** Messages seen since a moment, newest last. */
    @Synchronized fun since(millis: Long): List<Sms> = recent.filter { it.atMillis >= millis }

    @Synchronized fun clear() = recent.clear()
}
