import { Boss, Item, Raider, RollEntry, Season, Session, SessionDetail, Tier } from '../shared/types';

export async function getSessionDetail(db: D1Database, sessionId: number): Promise<SessionDetail | null> {
  const session = await db.prepare('SELECT * FROM sessions WHERE id = ?').bind(sessionId).first<Session>();
  if (!session) return null;
  const season = await db.prepare('SELECT * FROM seasons WHERE id = ?').bind(session.season_id).first<Season>();
  if (!season) return null;

  const [bossRows, itemRows, raiderRows] = await Promise.all([
    db
      .prepare('SELECT id, name, icon, sort_order FROM bosses WHERE session_id = ? ORDER BY sort_order, id')
      .bind(sessionId)
      .all<Omit<Boss, 'items'>>(),
    db
      .prepare(
        `SELECT i.* FROM items i JOIN bosses b ON b.id = i.boss_id
         WHERE b.session_id = ? ORDER BY b.sort_order, b.id, i.sort_order, i.id`,
      )
      .bind(sessionId)
      .all<Item>(),
    getSessionRaiders(db, sessionId),
  ]);

  const bosses: Boss[] = bossRows.results.map((b) => ({
    ...b,
    items: itemRows.results.filter((i) => i.boss_id === b.id),
  }));

  return { session, season, bosses, raiders: raiderRows };
}

interface RaiderRow {
  id: number;
  username: string;
  item_level: number;
  has_dibs: number;
  need_available: number;
  dibs_locked: number;
}

export async function getSessionRaiders(db: D1Database, sessionId: number): Promise<Raider[]> {
  const rows = await db
    .prepare(
      `SELECT r.id, r.username, ssr.item_level, sr.has_dibs, ssr.need_available, ssr.dibs_locked
       FROM session_raiders ssr
       JOIN raiders r ON r.id = ssr.raider_id
       JOIN sessions s ON s.id = ssr.session_id
       JOIN season_raiders sr ON sr.season_id = s.season_id AND sr.raider_id = r.id
       WHERE ssr.session_id = ?
       ORDER BY ssr.joined_at, r.id`,
    )
    .bind(sessionId)
    .all<RaiderRow>();
  return rows.results.map((r) => ({
    id: r.id,
    username: r.username,
    item_level: r.item_level,
    has_dibs: !!r.has_dibs,
    need_available: !!r.need_available,
    dibs_locked: !!r.dibs_locked,
  }));
}

/** Ordered list of item ids for a session that have not yet been resolved. */
export async function getPendingItemIds(db: D1Database, sessionId: number): Promise<number[]> {
  const rows = await db
    .prepare(
      `SELECT i.id FROM items i JOIN bosses b ON b.id = i.boss_id
       WHERE b.session_id = ? AND i.resolved_at IS NULL
       ORDER BY b.sort_order, b.id, i.sort_order, i.id`,
    )
    .bind(sessionId)
    .all<{ id: number }>();
  return rows.results.map((r) => r.id);
}

export async function getItemWithBoss(db: D1Database, itemId: number) {
  return db
    .prepare(
      `SELECT i.id, i.name, b.name AS boss_name, b.session_id
       FROM items i JOIN bosses b ON b.id = i.boss_id WHERE i.id = ?`,
    )
    .bind(itemId)
    .first<{ id: number; name: string; boss_name: string; session_id: number }>();
}

export interface PersistResult {
  itemId: number;
  winnerId: number | null;
  winTier: Tier | null;
  entries: { raiderId: number; tier: Tier; roll: number | null; won: boolean }[];
}

export async function persistResult(db: D1Database, sessionId: number, r: PersistResult) {
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [
    db
      .prepare('UPDATE items SET winner_raider_id = ?, win_tier = ?, resolved_at = ? WHERE id = ?')
      .bind(r.winnerId, r.winTier, now, r.itemId),
  ];
  for (const e of r.entries) {
    stmts.push(
      db
        .prepare('INSERT INTO rolls (item_id, raider_id, tier, roll_value, won) VALUES (?, ?, ?, ?, ?)')
        .bind(r.itemId, e.raiderId, e.tier, e.roll, e.won ? 1 : 0),
    );
  }
  if (r.winnerId != null) stmts.push(...resourceStatements(db, sessionId, r.winnerId, r.winTier, true));
  // Plans for this item are no longer needed.
  stmts.push(db.prepare('DELETE FROM plans WHERE item_id = ?').bind(r.itemId));
  await db.batch(stmts);
}

/** raiderId -> planned tier for one item. */
export async function getPlansForItem(db: D1Database, itemId: number): Promise<Record<number, Tier>> {
  const rows = await db.prepare('SELECT raider_id, tier FROM plans WHERE item_id = ?').bind(itemId).all<{ raider_id: number; tier: Tier }>();
  const out: Record<number, Tier> = {};
  for (const r of rows.results) out[r.raider_id] = r.tier;
  return out;
}

/** All recorded rolls for a session, grouped by item id, with the roller's current season ilvl. */
export async function getSessionRolls(db: D1Database, sessionId: number): Promise<Record<number, RollEntry[]>> {
  const rows = await db
    .prepare(
      `SELECT ro.item_id, ro.raider_id, r.username, ro.tier, ro.roll_value, ro.won, COALESCE(ssr.item_level, 0) AS item_level
       FROM rolls ro
       JOIN items i ON i.id = ro.item_id JOIN bosses b ON b.id = i.boss_id JOIN sessions s ON s.id = b.session_id
       JOIN raiders r ON r.id = ro.raider_id
       LEFT JOIN session_raiders ssr ON ssr.session_id = s.id AND ssr.raider_id = ro.raider_id
       WHERE s.id = ? ORDER BY ro.id`,
    )
    .bind(sessionId)
    .all<{ item_id: number; raider_id: number; username: string; tier: Tier; roll_value: number | null; won: number; item_level: number }>();
  const out: Record<number, RollEntry[]> = {};
  for (const r of rows.results) {
    (out[r.item_id] ??= []).push({
      raiderId: r.raider_id,
      username: r.username,
      tier: r.tier,
      roll: r.roll_value,
      itemLevel: r.item_level,
      won: !!r.won,
    });
  }
  return out;
}

/**
 * Statements that take away (or give back) what a win costs:
 * - Need win: need spent for the session AND Dibs locked for the session.
 * - Dibs win: Dibs spent for the season AND need spent for the session.
 */
export function resourceStatements(db: D1Database, sessionId: number, raiderId: number, tier: Tier | null, consume: boolean): D1PreparedStatement[] {
  const avail = consume ? 0 : 1;
  const locked = consume ? 1 : 0;
  if (tier === 'need') {
    return [
      db
        .prepare('UPDATE session_raiders SET need_available = ?, dibs_locked = ? WHERE session_id = ? AND raider_id = ?')
        .bind(avail, locked, sessionId, raiderId),
    ];
  }
  if (tier === 'dibs') {
    return [
      db
        .prepare('UPDATE season_raiders SET has_dibs = ? WHERE raider_id = ? AND season_id = (SELECT season_id FROM sessions WHERE id = ?)')
        .bind(avail, raiderId, sessionId),
      db.prepare('UPDATE session_raiders SET need_available = ? WHERE session_id = ? AND raider_id = ?').bind(avail, sessionId, raiderId),
    ];
  }
  return [];
}

/**
 * Derive a raider's Need / Dibs state from the items they have actually won, so admin
 * re-awards (change tier, give away, remove winner) always leave a consistent result.
 */
export function recomputeRaiderResources(db: D1Database, sessionId: number, raiderId: number): D1PreparedStatement[] {
  const wonInSession = `SELECT 1 FROM items i JOIN bosses b ON b.id = i.boss_id
                        WHERE b.session_id = ? AND i.winner_raider_id = ?`;
  return [
    db
      .prepare(
        `UPDATE session_raiders SET
           need_available = NOT EXISTS(${wonInSession} AND i.win_tier IN ('need','dibs')),
           dibs_locked    =     EXISTS(${wonInSession} AND i.win_tier = 'need')
         WHERE session_id = ? AND raider_id = ?`,
      )
      .bind(sessionId, raiderId, sessionId, raiderId, sessionId, raiderId),
    db
      .prepare(
        `UPDATE season_raiders SET has_dibs = NOT EXISTS(
           SELECT 1 FROM items i JOIN bosses b ON b.id = i.boss_id JOIN sessions s ON s.id = b.session_id
           WHERE s.season_id = season_raiders.season_id AND i.winner_raider_id = ? AND i.win_tier = 'dibs')
         WHERE raider_id = ? AND season_id = (SELECT season_id FROM sessions WHERE id = ?)`,
      )
      .bind(raiderId, raiderId, sessionId),
  ];
}

/**
 * Put a raider into a session: create their season record if this is their first session of the
 * season (Dibs available), update their item level, and add them to the session.
 */
export async function joinSession(db: D1Database, sessionId: number, seasonId: number, raiderId: number, itemLevel: number) {
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO season_raiders (season_id, raider_id) VALUES (?, ?)').bind(seasonId, raiderId),
    db
      .prepare(
        `INSERT INTO session_raiders (session_id, raider_id, item_level, joined_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(session_id, raider_id) DO UPDATE SET item_level = excluded.item_level`,
      )
      .bind(sessionId, raiderId, itemLevel, Date.now()),
  ]);
}

export function setItemLevelStatements(db: D1Database, sessionId: number, raiderId: number, itemLevel: number): D1PreparedStatement[] {
  return [db.prepare('UPDATE session_raiders SET item_level = ? WHERE session_id = ? AND raider_id = ?').bind(itemLevel, sessionId, raiderId)];
}

/** SQL expression: a raider's most recent item level in a season (0 if none). Expects (raider_id, season_id) bound in order. */
export const LAST_ILVL_SQL = `COALESCE((
  SELECT ssr.item_level FROM session_raiders ssr JOIN sessions s ON s.id = ssr.session_id
  WHERE ssr.raider_id = ? AND s.season_id = ? ORDER BY ssr.joined_at DESC LIMIT 1), 0)`;

/** Find-or-create a raider by (case-insensitive) username. */
export async function upsertRaider(db: D1Database, username: string) {
  await db.prepare('INSERT OR IGNORE INTO raiders (username, created_at) VALUES (?, ?)').bind(username, Date.now()).run();
  return db.prepare('SELECT id, username FROM raiders WHERE username = ?').bind(username).first<{ id: number; username: string }>();
}

export async function setSessionStatus(db: D1Database, sessionId: number, status: Session['status']) {
  await db.prepare('UPDATE sessions SET status = ? WHERE id = ?').bind(status, sessionId).run();
}
