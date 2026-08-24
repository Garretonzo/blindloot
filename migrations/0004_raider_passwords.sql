-- Per-raider login passwords. NULL means "not set yet": the raider chooses one on
-- their first login, and an admin can reset it back to NULL to unlock someone.
ALTER TABLE raiders ADD COLUMN password_hash TEXT;
