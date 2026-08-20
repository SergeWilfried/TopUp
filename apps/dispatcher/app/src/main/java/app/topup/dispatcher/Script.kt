package app.topup.dispatcher

import org.json.JSONObject
import java.security.MessageDigest

/**
 * The USSD menu, and the rules for walking it.
 *
 * Everything in this file is deliberately free of Android types so it can be
 * tested on a laptop. The parts that touch a real dialog live in
 * [UssdExecutor]; the decisions about what to type, and what a half-finished
 * session means, live here.
 */

data class Step(val expect: Regex, val send: String)

data class Script(
    val version: Int,
    val entry: String,
    val steps: List<Step>,
    /** Matches the operator's SMS receipt. Absent means we can never confirm. */
    val successRe: Regex?,
) {
    companion object {
        fun parse(json: String): Script {
            val o = JSONObject(json)
            val arr = o.getJSONArray("steps")
            val steps = (0 until arr.length()).map { i ->
                val s = arr.getJSONObject(i)
                Step(Regex(s.getString("expect"), RegexOption.IGNORE_CASE), s.getString("send"))
            }
            require(steps.isNotEmpty()) { "script has no steps" }
            val success = o.optString("successRe", "").takeIf { it.isNotBlank() }
            return Script(
                version = o.optInt("version", 1),
                entry = o.getString("entry"),
                steps = steps,
                successRe = success?.let { Regex(it, RegexOption.IGNORE_CASE) },
            )
        }
    }
}

/** What the device was asked to do. The PIN is not here — it never leaves storage. */
data class Job(val jobId: String, val msisdn: String, val amount: Int, val carrier: String)

/**
 * How a session ended, in the vocabulary the worker already speaks.
 *
 * The distinction between [Failed] and [Unknown] is the whole safety model.
 * `failed` says nothing happened and the order may be dispatched again.
 * `unknown` says we cannot tell, and the worker will park it for a human
 * rather than risk sending a second top-up the customer already received.
 */
sealed interface Outcome {
    data class Sent(val providerRef: String, val raw: String) : Outcome
    data class Failed(val reason: String) : Outcome
    data class Unknown(val reason: String, val raw: String?) : Outcome
}

/**
 * Walks one menu, strictly in order.
 *
 * The rule that matters: a step is only sent when its own `expect` matches the
 * dialog in front of it. There is no searching ahead for a step that fits, and
 * no sending anything at a dialog we did not predict. An unrecognised dialog is
 * usually the operator saying something went wrong — "solde insuffisant",
 * "numero invalide", a changed menu — and typing a PIN into it is how a
 * credential ends up somewhere it should not be.
 */
class ScriptRunner(private val script: Script, private val job: Job, private val pin: String) {
    private var index = 0

    /** True once any input has gone to the operator. See [abandon]. */
    var committed: Boolean = false
        private set

    val finished: Boolean get() = index >= script.steps.size

    /**
     * The reply for this dialog, or null if it is not what we expected.
     *
     * A null answer is never "skip and carry on" — the caller must abandon the
     * session. Returning a value advances the machine, so it is called once per
     * dialog.
     */
    fun next(dialogText: String): String? {
        if (finished) return null
        val step = script.steps[index]
        if (!step.expect.containsMatchIn(dialogText)) return null
        index++
        committed = true
        return substitute(step.send)
    }

    private fun substitute(template: String): String =
        template
            .replace("{msisdn}", job.msisdn)
            .replace("{amount}", job.amount.toString())
            .replace("{pin}", pin)

    /**
     * How to report a session that ended before the last step.
     *
     * Nothing typed yet means nothing moved: the dial failed, or the first
     * dialog never appeared, and the order is safe to try again. Once a single
     * input has gone out we no longer know how far the operator got, so the
     * only honest answer is that we do not know.
     */
    fun abandon(reason: String, raw: String?): Outcome =
        if (committed) Outcome.Unknown(reason, raw) else Outcome.Failed(reason)
}

/**
 * A reference for a transfer the operator did not give one for.
 *
 * These receipts carry an amount and a sender and nothing else, so there is no
 * natural key to dedupe on or quote to a customer. This makes one that is
 * stable for a given transfer and distinct across transfers, which is all the
 * worker needs — it treats the value as opaque.
 */
fun synthesizeRef(agentMsisdn: String, recipient: String, amount: Int, smsAtMillis: Long): String {
    val material = "$agentMsisdn|$recipient|$amount|$smsAtMillis"
    val digest = MessageDigest.getInstance("SHA-256").digest(material.toByteArray())
    return "loc_" + digest.take(8).joinToString("") { "%02x".format(it) }
}

/**
 * Whether this SMS is the receipt for this job.
 *
 * Correlation is temporal, not textual: one USSD session runs on a SIM at a
 * time, so the receipt that arrives while a job is in flight belongs to it.
 * The amount is checked anyway as a cheap guard against an unrelated operator
 * message that happens to match the success pattern.
 */
fun isReceiptFor(script: Script, job: Job, body: String): Boolean {
    val re = script.successRe ?: return false
    if (!re.containsMatchIn(body)) return false
    val digits = body.replace("[^0-9]".toRegex(), " ")
    return digits.split(" ").any { it.toIntOrNull() == job.amount }
}
