-- Loot distribution schema.
--
-- Hierarchy: seasons → sessions → bosses → items.
-- Raiders are a site-wide roster; their password is set on first login (NULL until then;
-- an admin reset returns it to NULL). Loot charges are admin-configurable per season:
-- Dibs charges span the season, Need wins are per session, and a Dibs win also spends a
-- Need charge (so Dibs is locked whenever Need is exhausted). Remaining charges are
-- derived as limit − recorded wins, so re-awards and limit changes stay consistent.
-- Every roll (all participants) and every pre-planned choice is recorded so history can
-- be reviewed and winners re-awarded.

CREATE TABLE seasons (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT    NOT NULL,
  raid_id          TEXT    NOT NULL,             -- bundled boss/loot pool (src/shared/raids)
  created_at       INTEGER NOT NULL,
  dibs_per_season  INTEGER NOT NULL DEFAULT 1,   -- Dibs charges each raider gets for the whole season
  need_per_session INTEGER NOT NULL DEFAULT 1    -- Need wins each raider is allowed per session
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
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  created_at    INTEGER NOT NULL,
  password_hash TEXT                            -- pbkdf2v1:<iter>:<salt>:<hash>; NULL = set on first login
);

-- Season-scoped state: remaining Dibs charges (seeded from seasons.dibs_per_season on join).
CREATE TABLE season_raiders (
  season_id      INTEGER NOT NULL REFERENCES seasons(id),
  raider_id      INTEGER NOT NULL REFERENCES raiders(id),
  dibs_remaining INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (season_id, raider_id)
);

-- Session-scoped state: item level and remaining Need charges (seeded from
-- seasons.need_per_session on join). A Need or Dibs win spends one Need charge.
CREATE TABLE session_raiders (
  session_id     INTEGER NOT NULL REFERENCES sessions(id),
  raider_id      INTEGER NOT NULL REFERENCES raiders(id),
  item_level     INTEGER NOT NULL DEFAULT 0,
  need_remaining INTEGER NOT NULL DEFAULT 1,
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
  win_tier         TEXT,                        -- greed | offspec | equip | need | dibs
  resolved_at      INTEGER,                     -- set once rolled, even if nobody won
  resolved_mode    TEXT                         -- batch | live | award
);

-- Every participant's roll on every item (losers included) so runner-ups can be ranked.
CREATE TABLE rolls (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id     INTEGER NOT NULL REFERENCES items(id),
  raider_id   INTEGER NOT NULL REFERENCES raiders(id),
  tier        TEXT    NOT NULL,                 -- what the roll counted as (after demotion)
  picked_tier TEXT,                             -- the raider's pre-pick at resolution time (null = rolled live)
  roll_value  INTEGER,                          -- null when they were the only roller
  won         INTEGER NOT NULL DEFAULT 0
);

-- Raiders' pre-planned choices for items not yet rolled.
CREATE TABLE plans (
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  item_id    INTEGER NOT NULL REFERENCES items(id),
  raider_id  INTEGER NOT NULL REFERENCES raiders(id),
  tier       TEXT    NOT NULL,                  -- pass | greed | offspec | equip | need | dibs
  PRIMARY KEY (item_id, raider_id)
);

CREATE INDEX idx_sessions_season        ON sessions(season_id);
CREATE INDEX idx_session_raiders_raider ON session_raiders(raider_id);
CREATE INDEX idx_bosses_session         ON bosses(session_id);
CREATE INDEX idx_items_boss             ON items(boss_id);
CREATE INDEX idx_rolls_item             ON rolls(item_id);
CREATE INDEX idx_plans_session_raider   ON plans(session_id, raider_id);
