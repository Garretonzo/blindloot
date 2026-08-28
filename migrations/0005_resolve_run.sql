-- Which resolution run resolved this item: ms timestamp taken when the run started
-- (one instant batch = one run; one live roll-off start->finish = one run).
-- NULL = manual admin award, or resolved before this column existed.
ALTER TABLE items ADD COLUMN resolve_run INTEGER;
