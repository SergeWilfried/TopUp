package app.topup.dispatcher

/**
 * Whatever can actually hold a USSD conversation.
 *
 * Two implementations are expected and the rest of the app must not be able to
 * tell them apart:
 *
 *  - [UssdAccessibilityService] drives the handset's own dialog. Cheap to start
 *    with, and fragile in the way anything UI-shaped is — it depends on the OEM
 *    skin and breaks when the OS updates.
 *  - A GSM modem speaking `AT+CUSD`, which handles interactive sessions as a
 *    first-class thing and needs no Android at all. More to buy, far less to
 *    babysit, and where this ends up if the bench grows.
 *
 * The seam exists now, while it is free, rather than later when it would mean
 * rewriting the loop that moves money.
 */
interface UssdExecutor {
    /** True when this executor is wired up and permitted to run. */
    fun ready(): Boolean

    /**
     * Runs one transfer to completion or to a stop, and reports which.
     *
     * Implementations must honour [ScriptRunner]'s refusal: when `next()`
     * returns null the dialog was not the expected one, and the session has to
     * be abandoned rather than answered.
     */
    suspend fun run(script: Script, job: Job, pin: String): Outcome
}
