package app.topup.dispatcher

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.IBinder
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job as CoJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * The loop: ask for work, do it, say what happened.
 *
 * A foreground service because the alternative is Android deciding a bench
 * device is idle and stopping it, which looks from the outside like the farm
 * simply not working on the busiest evening of the month.
 */
class DispatchService : Service() {

    private val scope = CoroutineScope(Dispatchers.Default)
    private var loop: CoJob? = null
    private lateinit var config: Config
    private lateinit var api: Api

    override fun onCreate() {
        super.onCreate()
        config = Config(this)
        api = Api(config)
        startForeground(NOTIFICATION_ID, notification("Starting"))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (loop == null) loop = scope.launch { run() }
        // Restart if the system kills us: this should be running whenever the
        // device is on and provisioned.
        return START_STICKY
    }

    override fun onDestroy() {
        loop?.cancel()
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private suspend fun run() {
        while (scope.isActive) {
            val waited = try {
                tick()
            } catch (e: Exception) {
                note("Error: ${e.message?.take(60)}")
                ERROR_BACKOFF_MS
            }
            delay(waited)
        }
    }

    /** One pass. Returns how long to wait before the next one. */
    private suspend fun tick(): Long {
        if (!config.provisioned) {
            note("Not provisioned")
            return IDLE_MS
        }

        val executor: UssdExecutor? = UssdAccessibilityService.instance
        if (!config.dryRun && executor?.ready() != true) {
            // Refusing to claim is deliberate: a job leased by a device that
            // cannot dial would sit until its lease expired and then be parked
            // as unknown, which is a support ticket manufactured out of a
            // missing permission.
            note("Accessibility service off — not claiming")
            return IDLE_MS
        }

        val job = api.claim(balance = null) ?: run { note("Idle"); return IDLE_MS }
        note("Job ${job.jobId.takeLast(6)} · ${job.amount} to ${job.msisdn}")

        val outcome = execute(job, executor)
        api.report(job.jobId, outcome, balance = null)
        note("Reported ${outcome::class.simpleName?.lowercase()}")
        // Straight back for the next one — a queue that has one job usually has
        // several, and the operator's cap is the thing that should throttle us.
        return BUSY_MS
    }

    private suspend fun execute(job: Job, executor: UssdExecutor?): Outcome {
        if (config.dryRun) {
            return Outcome.Failed("dry_run")
        }
        val script = api.script()
        val startedAt = System.currentTimeMillis()

        dial(script.entry)
        val outcome = executor!!.run(script, job, config.pin)

        // The session having typed everything is not the same as the money
        // having moved. Only the receipt says that.
        if (outcome is Outcome.Unknown && outcome.reason == "awaiting_receipt") {
            val receipt = awaitReceipt(script, job, startedAt)
            return if (receipt != null) {
                Outcome.Sent(
                    providerRef = synthesizeRef(config.msisdn, job.msisdn, job.amount, receipt.atMillis),
                    raw = receipt.body,
                )
            } else {
                // Typed the whole menu and no receipt came. Genuinely unknown:
                // it may land in a minute, or never. The worker parks it.
                Outcome.Unknown("no_receipt_within_timeout", outcome.raw)
            }
        }
        return outcome
    }

    private suspend fun awaitReceipt(script: Script, job: Job, since: Long): Sms? {
        val deadline = System.currentTimeMillis() + RECEIPT_TIMEOUT_MS
        while (System.currentTimeMillis() < deadline) {
            Inbox.since(since).firstOrNull { isReceiptFor(script, job, it.body) }?.let { return it }
            delay(2_000)
        }
        return null
    }

    /**
     * Opens the session.
     *
     * `#` has to be encoded or the dialer swallows the rest of the string,
     * which is a classic way to place a call to a partial number instead of
     * running a USSD code.
     */
    private fun dial(entry: String) {
        val encoded = Uri.encode(entry)
        startActivity(
            Intent(Intent.ACTION_CALL, Uri.parse("tel:$encoded")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }

    private fun note(text: String) {
        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(NOTIFICATION_ID, notification(text))
    }

    private fun notification(text: String): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL, "Dispatch", NotificationManager.IMPORTANCE_LOW),
            )
        }
        return Notification.Builder(this, CHANNEL)
            .setContentTitle(if (Config(this).dryRun) "Dispatcher (dry run)" else "Dispatcher")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val CHANNEL = "dispatch"
        private const val NOTIFICATION_ID = 1

        private const val IDLE_MS = 15_000L
        private const val BUSY_MS = 1_500L
        private const val ERROR_BACKOFF_MS = 30_000L
        private const val RECEIPT_TIMEOUT_MS = 120_000L

        fun start(context: Context) {
            val intent = Intent(context, DispatchService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
            else context.startService(intent)
        }
    }
}
