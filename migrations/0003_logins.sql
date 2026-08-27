-- Durable raider logins: replaces the PresenceDO's in-memory token store.
-- A row is a device/tab holding the (unhashed) UUID token; valid until logout or admin end.
CREATE TABLE logins (
  token_hash TEXT PRIMARY KEY,   -- SHA-256 hex of the client-held UUID token
  raider_id  INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL
);
CREATE INDEX idx_logins_raider ON logins(raider_id);
