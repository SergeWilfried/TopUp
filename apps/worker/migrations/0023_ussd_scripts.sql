-- The USSD menu, as data.
--
-- Airtime transfer on these operators is a menu, not a single string: choose
-- an option, type the recipient, type the amount, type the PIN, confirm. The
-- device drives that dialog, but the steps must not live in the APK — an
-- operator reordering their menu would then mean reflashing every handset on
-- the bench, during an outage, by hand.
--
-- So the sequence is a row here and the device fetches it. `version` lets a
-- device notice a change without diffing, and lets a report say which script
-- it was running when something went wrong.
CREATE TABLE IF NOT EXISTS ussd_scripts (
  country    TEXT NOT NULL,
  carrier    TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  -- The dial string that opens the session, e.g. "*144#".
  entry      TEXT NOT NULL,
  -- JSON array of {expect, send} — `expect` is a regex matched against the
  -- dialog text, `send` is the reply, with {msisdn} {amount} {pin} substituted
  -- on the device. The PIN never leaves the handset.
  steps      TEXT NOT NULL,
  -- Regex that identifies the operator's success SMS, so the device knows the
  -- transfer landed rather than guessing from the dialog.
  success_re TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (country, carrier)
);
