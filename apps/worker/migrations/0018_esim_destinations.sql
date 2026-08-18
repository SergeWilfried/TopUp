-- Retarget eSIM destinations to the markets the provider actually covers.
--
-- The seeded list was West African: Côte d'Ivoire (as a "home" eSIM), Senegal,
-- Burkina Faso, Kenya, Rwanda. Checked against the provider's Q3 2026 price
-- book (158 countries): Burkina Faso and Côte d'Ivoire are not in it at all,
-- and appear in no regional bundle either — tiles for them could only ever
-- lead to an empty plan list. Senegal, Kenya and Rwanda exist but are priced
-- for roaming (1 GB in Senegal wholesales at €4.81, ~3 800 F retail), which is
-- not what this market buys.
--
-- eSIM is a travel product here: the destinations are the places customers fly
-- to. Deactivated rather than deleted, because `esims.country` and product
-- rows reference these codes and history must keep reading correctly.
UPDATE destinations SET active = 0 WHERE code IN ('CI', 'SN', 'BF', 'KE', 'RW');

-- Names must match the provider's country names exactly: the plan sync joins
-- its `countryIso2` to `destinations.code`, and writes `destinations.name`
-- into `products.country`, which is what the app queries plans by.
INSERT INTO destinations (code, name, kind, coverage, coverage_key, active, sort_order) VALUES
  ('CN', 'China',         'travel', '', 'esim.travel', 1, 0),
  ('TR', 'Turkey',        'travel', '', 'esim.travel', 1, 1),
  ('IN', 'India',         'travel', '', 'esim.travel', 1, 2),
  ('US', 'United States', 'travel', '', 'esim.travel', 1, 3),
  ('CA', 'Canada',        'travel', '', 'esim.travel', 1, 4)
ON CONFLICT(code) DO UPDATE SET
  name = excluded.name, kind = excluded.kind, coverage_key = excluded.coverage_key,
  active = 1, sort_order = excluded.sort_order;

-- eSIM products for the retired destinations can no longer be provisioned.
UPDATE products SET enabled = 0
 WHERE type = 'esim' AND country IN ('Côte d''Ivoire', 'Senegal', 'Burkina Faso', 'Kenya', 'Rwanda');
