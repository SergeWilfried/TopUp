package app.topup.dispatcher

import android.accessibilityservice.AccessibilityService
import android.os.Bundle
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout

/**
 * Answers the handset's USSD dialog.
 *
 * The platform gives no API for a multi-step USSD session — `sendUssdRequest`
 * is one request and one response, which cannot carry a menu that asks for a
 * PIN. So this reads the dialog the telephony app puts on screen and types into
 * it, which is the only route available and the reason this app is sideloaded.
 *
 * Treat it as the fragile implementation it is: it depends on how one OEM
 * renders one dialog in one OS version. Keep the bench on a single handset
 * model, disable OS updates, and when the estate grows, move to modems.
 */
class UssdAccessibilityService : AccessibilityService(), UssdExecutor {

    /** Set while a transfer is in flight; null when idle so events are ignored. */
    @Volatile private var session: Session? = null

    private class Session(val runner: ScriptRunner, val script: Script) {
        val done = CompletableDeferred<Outcome>()
        var lastDialog: String? = null
        /** Dialogs already answered, so a repeated content event is not re-typed. */
        var lastAnswered: String? = null
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
    }

    override fun onDestroy() {
        instance = null
        super.onDestroy()
    }

    override fun onInterrupt() {}

    override fun ready(): Boolean = instance != null

    override suspend fun run(script: Script, job: Job, pin: String): Outcome {
        if (session != null) return Outcome.Failed("executor_busy")
        val s = Session(ScriptRunner(script, job, pin), script)
        session = s
        return try {
            // The dial itself is placed by the caller; this waits for the
            // conversation that follows. Generous, because a USSD round trip on
            // a weak signal is slow, but bounded — a session that never ends is
            // the one case that must not hold a SIM for ever.
            withTimeout(SESSION_TIMEOUT_MS) { s.done.await() }
        } catch (e: TimeoutCancellationException) {
            s.runner.abandon("session_timeout", s.lastDialog)
        } finally {
            session = null
        }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val s = session ?: return
        val root = rootInActiveWindow ?: return
        val text = collectText(root).trim()
        if (text.isEmpty() || text == s.lastAnswered) return
        s.lastDialog = text

        val reply = s.runner.next(text)
        if (reply == null) {
            // Not the dialog we predicted. This is usually the operator saying
            // something went wrong, and answering it blind could type a PIN
            // into an unknown prompt. Stop, and let the runner decide whether
            // anything had already been committed.
            s.done.complete(s.runner.abandon("unexpected_dialog", text))
            dismiss(root)
            return
        }

        val field = findEditable(root)
        if (field == null) {
            // The menu spoke but offered nowhere to answer — a terminal screen,
            // which after the last step is normal and before it is not.
            if (s.runner.finished) s.done.complete(Outcome.Unknown("awaiting_receipt", text))
            else s.done.complete(s.runner.abandon("no_input_field", text))
            dismiss(root)
            return
        }

        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, reply)
        }
        field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
        s.lastAnswered = text
        clickSend(root)

        if (s.runner.finished) {
            // Every step typed. The dialog's own "success" wording is not proof
            // — the receipt is — so this ends as unknown and the poller upgrades
            // it when the SMS lands.
            s.done.complete(Outcome.Unknown("awaiting_receipt", text))
        }
    }

    private fun collectText(node: AccessibilityNodeInfo?): String {
        if (node == null) return ""
        val sb = StringBuilder()
        node.text?.let { sb.append(it).append('\n') }
        for (i in 0 until node.childCount) sb.append(collectText(node.getChild(i)))
        return sb.toString()
    }

    private fun findEditable(node: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
        if (node == null) return null
        if (node.isEditable) return node
        for (i in 0 until node.childCount) findEditable(node.getChild(i))?.let { return it }
        return null
    }

    /**
     * Presses whichever button sends.
     *
     * Matched on label rather than resource id: ids differ across OEM skins and
     * change between versions, while the words on the button are the operator's
     * or the platform's and are far steadier. Both languages, because the menu
     * is French and the platform may not be.
     */
    private fun clickSend(root: AccessibilityNodeInfo) {
        for (label in SEND_LABELS) {
            val hit = root.findAccessibilityNodeInfosByText(label)?.firstOrNull { it.isClickable }
            if (hit != null) {
                hit.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                return
            }
        }
    }

    private fun dismiss(root: AccessibilityNodeInfo) {
        for (label in CANCEL_LABELS) {
            root.findAccessibilityNodeInfosByText(label)?.firstOrNull { it.isClickable }?.let {
                it.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                return
            }
        }
        performGlobalAction(GLOBAL_ACTION_BACK)
    }

    companion object {
        @Volatile var instance: UssdAccessibilityService? = null
            private set

        private const val SESSION_TIMEOUT_MS = 90_000L
        private val SEND_LABELS = listOf("Envoyer", "Send", "OK", "Ok")
        private val CANCEL_LABELS = listOf("Annuler", "Cancel", "Fermer", "Close")
    }
}
