-- Restore points: full snapshots of the app tables, created and restored by the super
-- admin from the site. The serialized snapshot is chunked across rows to stay well under
-- D1's per-value size limit. These two tables are never part of a snapshot themselves.

CREATE TABLE backups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  kind        TEXT    NOT NULL DEFAULT 'manual',   -- manual | pre-restore | pre-import
  created_at  INTEGER NOT NULL,
  bytes       INTEGER NOT NULL,                    -- UTF-8 size of the serialized snapshot
  chunk_count INTEGER NOT NULL
);

CREATE TABLE backup_chunks (
  backup_id INTEGER NOT NULL REFERENCES backups(id),
  idx       INTEGER NOT NULL,
  data      TEXT    NOT NULL,
  PRIMARY KEY (backup_id, idx)
);
