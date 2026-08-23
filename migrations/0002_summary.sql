-- Session summary: keep each raider's original pre-pick and how an item was resolved.
ALTER TABLE rolls ADD COLUMN picked_tier TEXT;          -- pre-pick at resolution time (NULL = none)
ALTER TABLE items ADD COLUMN resolved_mode TEXT;        -- 'batch' | 'live' | 'award'
