-- Where the line being topped up is, as an ISO-2 code.
--
-- Delivery needs a dialling code to put the recipient's number in the form the
-- distributor wants. The only country on the order until now came from the
-- product, which stores a display name ("Côte d'Ivoire") — not something a
-- dialling-code lookup can use, and wrong anyway once someone tops up a line in
-- another country. The app's country picker already knows this value.
ALTER TABLE orders ADD COLUMN recipient_country TEXT;
