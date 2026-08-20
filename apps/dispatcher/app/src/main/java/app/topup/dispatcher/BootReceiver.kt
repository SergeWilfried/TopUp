package app.topup.dispatcher

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Brings the bench back after a power cut without anyone present.
 *
 * A dispatcher that needs a human to tap it after every reboot is a dispatcher
 * that is off whenever it matters.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        if (!Config(context).provisioned) return
        DispatchService.start(context)
    }
}
