-- LAfricaMobile identifies a data bundle by an opaque id, not by size.
--
-- A bundle purchase sends `bundleid`; airtime sends only an amount. Without a
-- column to hold it, every data product was undeliverable and checkout refused
-- the sale — correctly, but it meant the whole INTERNET tab was unsellable.
--
-- Values come from GET /checkbundle?operateur=<code>, e.g.
--   1ac7a3ad99047ed07db7caac74d2a84b-11216  (ORANGEBF, 75 Mo, 175 XOF)
-- They are operator-scoped and change, so they are data rather than code.
ALTER TABLE products ADD COLUMN bundle_id TEXT;
