-- Six destinations added, ordered by who actually flies from this market.
--
-- Saudi Arabia carries Hajj and Umrah: a fixed season, an identifiable cohort
-- months ahead, and trips long enough that a 5 GB / 15-day plan fits exactly.
-- The UAE is the Dubai buying trip and carries the highest gross of any plan
-- in the book for us. France, Spain, Germany and Luxembourg are diaspora,
-- students and medical travel, and are the cheapest corridors we sell — a
-- 10 GB French plan costs us 2 775 F.
--
-- Names must match the provider's country names exactly: the plan sync joins
-- `countryIso2` to `code` and writes `name` into `products.country`, which is
-- what the app queries plans by.
INSERT INTO destinations (code, name, kind, coverage, coverage_key, active, sort_order) VALUES
  ('SA', 'Saudi Arabia',         'travel', '', 'esim.travel', 1, 0),
  ('AE', 'United Arab Emirates', 'travel', '', 'esim.travel', 1, 1),
  ('FR', 'France',               'travel', '', 'esim.travel', 1, 2),
  ('ES', 'Spain',                'travel', '', 'esim.travel', 1, 3),
  ('DE', 'Germany',              'travel', '', 'esim.travel', 1, 4),
  ('LU', 'Luxembourg',           'travel', '', 'esim.travel', 1, 5)
ON CONFLICT(code) DO UPDATE SET
  name = excluded.name, kind = excluded.kind, coverage_key = excluded.coverage_key,
  active = 1, sort_order = excluded.sort_order;

-- Keep the existing five below the new ones rather than interleaved.
UPDATE destinations SET sort_order = 6 WHERE code = 'CN';
UPDATE destinations SET sort_order = 7 WHERE code = 'TR';
UPDATE destinations SET sort_order = 8 WHERE code = 'IN';
UPDATE destinations SET sort_order = 9 WHERE code = 'US';
UPDATE destinations SET sort_order = 10 WHERE code = 'CA';
