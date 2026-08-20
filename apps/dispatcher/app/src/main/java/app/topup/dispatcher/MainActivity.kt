package app.topup.dispatcher

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.widget.*

/**
 * Provisioning and a status line. Nothing else.
 *
 * A bench device is set up once and then never touched, so this screen exists
 * to get a token and a PIN onto the handset and to answer "is it working"
 * without an adb cable.
 */
class MainActivity : Activity() {

    private lateinit var config: Config

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        config = Config(this)

        val url = field("Worker URL", config.baseUrl)
        val token = field("Agent token", config.token)
        val msisdn = field("This SIM's number", config.msisdn)
        val pin = field("SIM PIN", config.pin).apply {
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
        }
        val dry = CheckBox(this).apply {
            text = "Dry run — claim and report without dialling"
            isChecked = config.dryRun
        }

        val save = Button(this).apply {
            text = "SAVE AND START"
            setOnClickListener {
                config.baseUrl = url.text.toString()
                config.token = token.text.toString()
                config.msisdn = msisdn.text.toString()
                if (pin.text.isNotBlank()) config.pin = pin.text.toString()
                config.dryRun = dry.isChecked
                requestPermissions(arrayOf(Manifest.permission.RECEIVE_SMS, Manifest.permission.CALL_PHONE), 1)
                DispatchService.start(this@MainActivity)
                toast("Started")
            }
        }

        // Accessibility can only be granted by the user in Settings — there is
        // no programmatic path, by design.
        val a11y = Button(this).apply {
            text = "OPEN ACCESSIBILITY SETTINGS"
            setOnClickListener { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
        }
        val battery = Button(this).apply {
            text = "OPEN BATTERY OPTIMISATION"
            setOnClickListener { startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
        }

        setContentView(
            LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(40, 60, 40, 40)
                addView(TextView(this@MainActivity).apply { text = "TOPUP Dispatcher"; textSize = 22f })
                listOf(url, token, msisdn, pin, dry, save, a11y, battery).forEach { addView(it) }
                addView(TextView(this@MainActivity).apply {
                    text = "\nLeave dry run on until the whole loop has been seen working."
                    textSize = 12f
                })
            },
        )
    }

    private fun field(hint: String, value: String) = EditText(this).apply {
        this.hint = hint
        setText(value)
    }

    private fun toast(s: String) = Toast.makeText(this, s, Toast.LENGTH_SHORT).show()
}
