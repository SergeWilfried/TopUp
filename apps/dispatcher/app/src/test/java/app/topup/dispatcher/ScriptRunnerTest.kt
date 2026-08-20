package app.topup.dispatcher

import org.junit.Assert.*
import org.junit.Test

class ScriptRunnerTest {
    private val json = """
      {"version":3,"entry":"*144#","successRe":"Transfert de .* effectue",
       "steps":[{"expect":"1\\. Transfert","send":"1"},
                {"expect":"Numero","send":"{msisdn}"},
                {"expect":"Montant","send":"{amount}"},
                {"expect":"code secret","send":"{pin}"},
                {"expect":"Confirmer","send":"1"}]}
    """
    private val job = Job("job_1", "70112233", 1000, "Orange")
    private fun runner() = ScriptRunner(Script.parse(json), job, "4321")

    @Test fun `walks the menu in order and substitutes`() {
        val r = runner()
        assertEquals("1", r.next("Orange Money\n1. Transfert\n2. Solde"))
        assertEquals("70112233", r.next("Numero du beneficiaire"))
        assertEquals("1000", r.next("Montant a transferer"))
        assertEquals("4321", r.next("Entrez votre code secret"))
        assertEquals("1", r.next("Confirmer le transfert? 1. Oui"))
        assertTrue(r.finished)
    }

    @Test fun `refuses a dialog it did not predict`() {
        val r = runner()
        r.next("1. Transfert")
        // The operator interrupts with an error instead of asking for a number.
        assertNull(r.next("Solde insuffisant pour cette operation"))
    }

    @Test fun `never types the pin into an unexpected dialog`() {
        val r = runner()
        r.next("1. Transfert"); r.next("Numero"); r.next("Montant")
        val reply = r.next("Service temporairement indisponible")
        assertNull(reply)
        assertFalse("4321" == reply)
    }

    @Test fun `nothing sent yet is a failure, not an unknown`() {
        val r = runner()
        val out = r.abandon("dial_timeout", null)
        assertTrue(out is Outcome.Failed)
    }

    @Test fun `once committed, ambiguity is unknown`() {
        val r = runner()
        r.next("1. Transfert")
        val out = r.abandon("dialog_timeout", "…")
        assertTrue(out is Outcome.Unknown)
    }

    @Test fun `receipt must match both pattern and amount`() {
        val s = Script.parse(json)
        assertTrue(isReceiptFor(s, job, "Transfert de 1000 FCFA effectue vers 70112233"))
        // Right shape, wrong amount — a different transfer's receipt.
        assertFalse(isReceiptFor(s, job, "Transfert de 5000 FCFA effectue vers 70112233"))
        // Unrelated operator traffic.
        assertFalse(isReceiptFor(s, job, "Votre solde est de 1000 FCFA"))
    }

    @Test fun `synthesized ref is stable and distinct`() {
        val a = synthesizeRef("70998877", "70112233", 1000, 1_700_000_000_000)
        val b = synthesizeRef("70998877", "70112233", 1000, 1_700_000_000_000)
        val c = synthesizeRef("70998877", "70112233", 2000, 1_700_000_000_000)
        assertEquals(a, b)
        assertNotEquals(a, c)
        assertTrue(a.startsWith("loc_"))
    }
}
