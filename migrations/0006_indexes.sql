-- Hot-path indexes. Winner lookups (a raider's wins, charge recomputation, eligibility) used to
-- scan every item ever created; the winner's own roll on an item is now a point lookup; and a
-- raider's season records no longer scan season_raiders.
CREATE INDEX idx_items_winner ON items(winner_raider_id);
DROP INDEX idx_rolls_item;
CREATE INDEX idx_rolls_item_raider ON rolls(item_id, raider_id);
CREATE INDEX idx_season_raiders_raider ON season_raiders(raider_id);
