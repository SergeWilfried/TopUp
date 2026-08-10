-- Who the order was delivered to, when that is not the buyer.
--
-- `msisdn` at checkout is the wallet being charged. Topping up a friend used to
-- send their number as the payer, which on a mobile money rail would push the
-- approval prompt to them — the wrong person is asked to pay, and the buyer's
-- own history shows nothing. The two are separate fields now, and the recipient
-- is recorded here rather than only being buried in the display text.
ALTER TABLE orders ADD COLUMN recipient_msisdn TEXT;
