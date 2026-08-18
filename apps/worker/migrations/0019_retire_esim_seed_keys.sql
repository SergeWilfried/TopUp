-- Cut stored rows loose from the eSIM translation keys before those keys go.
--
-- Product prose is stored as a translation key plus params and resolved per
-- request, so the catalogue answers in either language. The keys for the old
-- invented eSIM tiers (esim.localValid30, esim.travelValid, esim.popular) and
-- the retired "home eSIM" coverage line (esim.home) are being deleted along
-- with the code that produced them — but rows in `products` and `destinations`
-- may still name them, and the resolver returns the raw key when it cannot
-- find one. That would print "esim.travelValid" into a customer's order
-- history.
--
-- So the text is frozen into the literal columns first, in English, matching
-- what `orders.detail` already does for a purchase snapshot. These are
-- disabled products and an inactive destination: history that must stay
-- readable, not a catalogue that must stay translatable.
UPDATE products
   SET terms = 'Local · Valid 30 days', terms_key = NULL, terms_params = NULL
 WHERE terms_key = 'esim.localValid30';

UPDATE products
   SET terms = 'Travel · Valid ' || COALESCE(json_extract(terms_params, '$.days'), '') || ' days',
       terms_key = NULL, terms_params = NULL
 WHERE terms_key = 'esim.travelValid' AND json_extract(terms_params, '$.days') IS NOT NULL;

-- Any left without a days param: the generic label rather than a dangling one.
UPDATE products
   SET terms = 'Travel', terms_key = NULL, terms_params = NULL
 WHERE terms_key = 'esim.travelValid';

UPDATE products SET bonus = 'POPULAR', bonus_key = NULL WHERE bonus_key = 'esim.popular';

UPDATE destinations SET coverage = 'Home · Orange, MTN, Moov', coverage_key = NULL
 WHERE coverage_key = 'esim.home';
