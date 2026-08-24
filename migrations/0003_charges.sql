-- Configurable loot charges.
--
-- Replaces the hardcoded one-charge rule (1 Dibs per season, 1 Need win per session,
-- Need win locks Dibs) with admin-configurable counters set on the season.
-- A Dibs roll now requires an available Need charge; a Dibs win consumes one Dibs
-- charge (season) and one Need charge (session). With both limits at 1 this behaves
-- exactly like the old boolean scheme, so existing 0/1 values need no backfill.
-- dibs_locked is subsumed: a Need win empties Need, which alone blocks Dibs.

ALTER TABLE seasons ADD COLUMN dibs_per_season INTEGER NOT NULL DEFAULT 1;
ALTER TABLE seasons ADD COLUMN need_per_session INTEGER NOT NULL DEFAULT 1;
ALTER TABLE season_raiders RENAME COLUMN has_dibs TO dibs_remaining;
ALTER TABLE session_raiders RENAME COLUMN need_available TO need_remaining;
ALTER TABLE session_raiders DROP COLUMN dibs_locked;
