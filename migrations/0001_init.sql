-- Loot distribution schema.
--
-- Hierarchy: seasons → sessions → bosses → items.
-- Raiders are a site-wide roster. Their Dibs is tracked per season; item level, Need and the
-- Dibs lock are tracked per session. Every roll (all participants) and every pre-planned choice
-- is recorded so history can be reviewed and winners re-awarded.

CREATE TABLE seasons (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  raid_id    TEXT    NOT NULL,                  -- bundled boss/loot pool (src/shared/raids)
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id  INTEGER NOT NULL REFERENCES seasons(id),
  name       TEXT    NOT NULL,
  status     TEXT    NOT NULL DEFAULT 'open',  -- open | staging | rolling | closed
  created_at INTEGER NOT NULL
);

-- Site-wide roster. Username is the identity (case-insensitive).
CREATE TABLE raiders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  username   TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  created_at INTEGER NOT NULL
);

-- One Dibs per raider per season; consumed only by winning with it.
CREATE TABLE season_raiders (
  season_id INTEGER NOT NULL REFERENCES seasons(id),
  raider_id INTEGER NOT NULL REFERENCES raiders(id),
  has_dibs  INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (season_id, raider_id)
);

-- Per-session state. Winning with Need spends need_available and sets dibs_locked;
-- winning with Dibs spends the season Dibs and need_available.
CREATE TABLE session_raiders (
  session_id     INTEGER NOT NULL REFERENCES sessions(id),
  raider_id      INTEGER NOT NULL REFERENCES raiders(id),
  item_level     INTEGER NOT NULL DEFAULT 0,
  need_available INTEGER NOT NULL DEFAULT 1,
  dibs_locked    INTEGER NOT NULL DEFAULT 0,
  joined_at      INTEGER NOT NULL,
  PRIMARY KEY (session_id, raider_id)
);

CREATE TABLE bosses (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  name       TEXT    NOT NULL,
  icon       TEXT,                              -- bundled asset path, null for custom bosses
  sort_order INTEGER NOT NULL
);

CREATE TABLE items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  boss_id          INTEGER NOT NULL REFERENCES bosses(id),
  name             TEXT    NOT NULL,
  icon             TEXT,                        -- bundled asset path, null for custom items
  sort_order       INTEGER NOT NULL,
  winner_raider_id INTEGER REFERENCES raiders(id),
  win_tier         TEXT,                        -- greed | equip | need | dibs
  resolved_at      INTEGER                      -- set once rolled, even if nobody won
);

-- Every participant's roll on every item (losers included) so runner-ups can be ranked.
CREATE TABLE rolls (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id    INTEGER NOT NULL REFERENCES items(id),
  raider_id  INTEGER NOT NULL REFERENCES raiders(id),
  tier       TEXT    NOT NULL,                  -- greed | equip | need | dibs
  roll_value INTEGER,                           -- null when they were the only roller
  won        INTEGER NOT NULL DEFAULT 0
);

-- Raiders' pre-planned choices for items not yet rolled.
CREATE TABLE plans (
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  item_id    INTEGER NOT NULL REFERENCES items(id),
  raider_id  INTEGER NOT NULL REFERENCES raiders(id),
  tier       TEXT    NOT NULL,                  -- greed | equip | need | dibs
  PRIMARY KEY (item_id, raider_id)
);

CREATE INDEX idx_sessions_season        ON sessions(season_id);
CREATE INDEX idx_session_raiders_raider ON session_raiders(raider_id);
CREATE INDEX idx_bosses_session         ON bosses(session_id);
CREATE INDEX idx_items_boss             ON items(boss_id);
CREATE INDEX idx_rolls_item             ON rolls(item_id);
CREATE INDEX idx_plans_session_raider   ON plans(session_id, raider_id);
