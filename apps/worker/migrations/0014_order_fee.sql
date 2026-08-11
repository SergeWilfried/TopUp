-- The service fee charged on top of a top-up's face value.
--
-- `amount` is what the recipient receives and what the distributor is asked to
-- send; the fee is what we are paid for saving the customer the trip. Keeping
-- them in one column would either understate what was charged or overstate what
-- must be delivered, and the fee is the revenue line — without it the console
-- reports turnover it never earned.
ALTER TABLE orders ADD COLUMN fee INTEGER NOT NULL DEFAULT 0;
