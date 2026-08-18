-- The network an order is delivered on, recorded on the order itself.
--
-- Delivery used to read it through the catalogue row (orders.sku → products),
-- which works only for orders that came from one. A free-amount airtime order
-- has no catalogue row, so the network the customer chose has to live here —
-- and it is written for catalogue orders too, so a product later repointed at
-- another operator cannot change where an already-paid order is delivered.
ALTER TABLE orders ADD COLUMN network TEXT;
