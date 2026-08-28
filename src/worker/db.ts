import { Boss, Item, Raider, RollEntry, Season, Session, SessionDetail, Tier } from '../shared/types';
import { WinCounts } from '../shared/resolve';

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
  avatar: string | null;
  item_level: number;
  dibs_remaining: number;
  need_remaining: number;
  dibs_per_season: number;
  need_per_session: number;
}

export async function getSessionRaiders(db: D1Database, sessionId: number): Promise<Raider[]> {
  const rows = await db
    .prepare(
      `SELECT r.id, r.username, r.avatar, ssr.item_level, sr.dibs_remaining, ssr.need_remaining,
              se.dibs_per_season, se.need_per_session
       FROM session_raiders ssr
       JOIN raiders r ON r.id = ssr.raider_id
       JOIN sessions s ON s.id = ssr.session_id
       JOIN seasons se ON se.id = s.season_id
       JOIN season_raiders sr ON sr.season_id = s.season_id AND sr.raider_id = r.id
       WHERE ssr.session_id = ?
       ORDER BY ssr.joined_at, r.id`,
    )
    .bind(sessionId)
    .all<RaiderRow>();
  return rows.results.map((r) => ({
    id: r.id,
    username: r.username,
    avatar: r.avatar,
    item_level: r.item_level,
    dibs_remaining: r.dibs_remaining,
    need_remaining: r.need_remaining,
    dibs_limit: r.dibs_per_season,
    need_limit: r.need_per_session,
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

export type ResolveMode = 'batch' | 'live' | 'award';

export interface PersistResult {
  itemId: number;
  winnerId: number | null;
  winTier: Tier | null;
  mode: ResolveMode;
  /** Resolution run this item belongs to (ms timestamp of the run's start); null for manual awards. */
  runId: number | null;
  entries: { raiderId: number; tier: Tier; pickedTier: Tier | null; roll: number | null; won: boolean }[];
}

export async function persistResult(db: D1Database, sessionId: number, r: PersistResult) {
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [
    db
      .prepare('UPDATE items SET winner_raider_id = ?, win_tier = ?, resolved_at = ?, resolved_mode = ?, resolve_run = ? WHERE id = ?')
      .bind(r.winnerId, r.winTier, now, r.mode, r.runId, r.itemId),
  ];
  for (const e of r.entries) {
    stmts.push(
      db
        .prepare('INSERT INTO rolls (item_id, raider_id, tier, picked_tier, roll_value, won) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(r.itemId, e.raiderId, e.tier, e.pickedTier, e.roll, e.won ? 1 : 0),
    );
  }
  // Charge the win: counters are re-derived from recorded wins (the items UPDATE above runs
  // first in this batch), so wins, refunds, and limit changes all share one derivation path.
  if (r.winnerId != null && (r.winTier === 'need' || r.winTier === 'dibs')) {
    stmts.push(...recomputeRaiderResources(db, sessionId, r.winnerId));
  }
  // Plans for this item are no longer needed.
  stmts.push(db.prepare('DELETE FROM plans WHERE item_id = ?').bind(r.itemId));
  await db.batch(stmts);
}

/** All pre-picks for a session's unresolved items, one row per (item, raider). */
export async function getPendingPlans(
  db: D1Database,
  sessionId: number,
): Promise<{ item_id: number; item_name: string; raider_id: number; tier: Tier }[]> {
  const rows = await db
    .prepare(
      `SELECT p.item_id, i.name AS item_name, p.raider_id, p.tier FROM plans p
       JOIN items i ON i.id = p.item_id
       WHERE p.session_id = ? AND i.resolved_at IS NULL`,
    )
    .bind(sessionId)
    .all<{ item_id: number; item_name: string; raider_id: number; tier: Tier }>();
  return rows.results;
}

/**
 * Ids of raiders who have already won ANOTHER item with the same name as `itemId` in its session.
 * One win per copy: these raiders are auto-passed on this copy. Derived from recorded wins (never
 * stored), so admin un-award/re-award self-heals just like charge recomputation.
 */
export async function getRaidersWhoWonCopy(db: D1Database, itemId: number): Promise<Set<number>> {
  const rows = await db
    .prepare(
      `SELECT DISTINCT w.winner_raider_id AS raider_id
       FROM items i JOIN bosses b ON b.id = i.boss_id
       JOIN bosses wb ON wb.session_id = b.session_id
       JOIN items w ON w.boss_id = wb.id
       WHERE i.id = ?1 AND w.id != ?1 AND w.name = i.name AND w.winner_raider_id IS NOT NULL`,
    )
    .bind(itemId)
    .all<{ raider_id: number }>();
  return new Set(rows.results.map((r) => r.raider_id));
}

/** raiderId -> item names already won in this session (for the one-win-per-copy rule). */
export async function getWonItemNames(db: D1Database, sessionId: number): Promise<Map<number, Set<string>>> {
  const rows = await db
    .prepare(
      `SELECT i.winner_raider_id AS raider_id, i.name FROM items i
       JOIN bosses b ON b.id = i.boss_id
       WHERE b.session_id = ? AND i.winner_raider_id IS NOT NULL`,
    )
    .bind(sessionId)
    .all<{ raider_id: number; name: string }>();
  const out = new Map<number, Set<string>>();
  for (const r of rows.results) {
    let set = out.get(r.raider_id);
    if (!set) out.set(r.raider_id, (set = new Set()));
    set.add(r.name);
  }
  return out;
}

/**
 * Per-raider win counts for the equalization filter. Scope matches each charge's scope:
 * Dibs wins are counted season-wide, every other tier this session only.
 */
export async function getWinCounts(db: D1Database, sessionId: number): Promise<WinCounts> {
  const rows = await db
    .prepare(
      `SELECT i.winner_raider_id AS raider_id, i.win_tier AS tier, COUNT(*) AS n
       FROM items i JOIN bosses b ON b.id = i.boss_id
       WHERE b.session_id = ?1 AND i.winner_raider_id IS NOT NULL AND i.win_tier != 'dibs'
       GROUP BY i.winner_raider_id, i.win_tier
       UNION ALL
       SELECT i.winner_raider_id, i.win_tier, COUNT(*)
       FROM items i JOIN bosses b ON b.id = i.boss_id JOIN sessions s ON s.id = b.session_id
       WHERE s.season_id = (SELECT season_id FROM sessions WHERE id = ?1)
         AND i.winner_raider_id IS NOT NULL AND i.win_tier = 'dibs'
       GROUP BY i.winner_raider_id, i.win_tier`,
    )
    .bind(sessionId)
    .all<{ raider_id: number; tier: Tier; n: number }>();
  const out: WinCounts = {};
  for (const r of rows.results) (out[r.raider_id] ??= {})[r.tier] = r.n;
  return out;
}

/** itemId -> a raider's recorded pre-pick on the items in this session that they WON (for showing winners their own pick). */
export async function getWinnerPickedTiers(db: D1Database, sessionId: number, raiderId: number): Promise<Record<number, Tier | null>> {
  const rows = await db
    .prepare(
      `SELECT ro.item_id, ro.picked_tier FROM rolls ro
       JOIN items i ON i.id = ro.item_id JOIN bosses b ON b.id = i.boss_id
       WHERE b.session_id = ?1 AND ro.raider_id = ?2 AND i.winner_raider_id = ?2`,
    )
    .bind(sessionId, raiderId)
    .all<{ item_id: number; picked_tier: Tier | null }>();
  const out: Record<number, Tier | null> = {};
  for (const r of rows.results) out[r.item_id] = r.picked_tier;
  return out;
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
 * Derive a raider's remaining Need / Dibs charges from the items they have actually won
 * (remaining = configured limit − wins, floored at 0), so wins, admin re-awards (change
 * tier, give away, remove winner), and limit changes always leave a consistent result.
 */
export function recomputeRaiderResources(db: D1Database, sessionId: number, raiderId: number): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `UPDATE session_raiders SET need_remaining = MAX(0,
           (SELECT se.need_per_session FROM seasons se JOIN sessions s ON s.season_id = se.id WHERE s.id = ?1)
           - (SELECT COUNT(*) FROM items i JOIN bosses b ON b.id = i.boss_id
              WHERE b.session_id = ?1 AND i.winner_raider_id = ?2 AND i.win_tier IN ('need','dibs')))
         WHERE session_id = ?1 AND raider_id = ?2`,
      )
      .bind(sessionId, raiderId),
    db
      .prepare(
        `UPDATE season_raiders SET dibs_remaining = MAX(0,
           (SELECT dibs_per_season FROM seasons WHERE id = season_raiders.season_id)
           - (SELECT COUNT(*) FROM items i JOIN bosses b ON b.id = i.boss_id JOIN sessions s ON s.id = b.session_id
              WHERE s.season_id = season_raiders.season_id AND i.winner_raider_id = ?1 AND i.win_tier = 'dibs'))
         WHERE raider_id = ?1 AND season_id = (SELECT season_id FROM sessions WHERE id = ?2)`,
      )
      .bind(raiderId, sessionId),
  ];
}

/**
 * Bulk recompute for every raider in a season (all their season and session counters).
 * Run after an admin changes the season's limits so the change applies retroactively.
 */
export function recomputeSeasonResources(db: D1Database, seasonId: number): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `UPDATE session_raiders SET need_remaining = MAX(0,
           (SELECT need_per_session FROM seasons WHERE id = ?1)
           - (SELECT COUNT(*) FROM items i JOIN bosses b ON b.id = i.boss_id
              WHERE b.session_id = session_raiders.session_id
                AND i.winner_raider_id = session_raiders.raider_id AND i.win_tier IN ('need','dibs')))
         WHERE session_id IN (SELECT id FROM sessions WHERE season_id = ?1)`,
      )
      .bind(seasonId),
    db
      .prepare(
        `UPDATE season_raiders SET dibs_remaining = MAX(0,
           (SELECT dibs_per_season FROM seasons WHERE id = ?1)
           - (SELECT COUNT(*) FROM items i JOIN bosses b ON b.id = i.boss_id JOIN sessions s ON s.id = b.session_id
              WHERE s.season_id = ?1 AND i.winner_raider_id = season_raiders.raider_id AND i.win_tier = 'dibs'))
         WHERE season_id = ?1`,
      )
      .bind(seasonId),
  ];
}

/**
 * Put a raider into a session: create their season record if this is their first session of the
 * season (full Dibs charges), update their item level, and add them to the session with the
 * season's configured Need allowance.
 */
export async function joinSession(db: D1Database, sessionId: number, seasonId: number, raiderId: number, itemLevel: number) {
  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO season_raiders (season_id, raider_id, dibs_remaining)
         SELECT ?1, ?2, dibs_per_season FROM seasons WHERE id = ?1`,
      )
      .bind(seasonId, raiderId),
    db
      .prepare(
        `INSERT INTO session_raiders (session_id, raider_id, item_level, need_remaining, joined_at)
         SELECT ?1, ?2, ?3, need_per_session, ?4 FROM seasons WHERE id = ?5
         ON CONFLICT(session_id, raider_id) DO UPDATE SET item_level = excluded.item_level`,
      )
      .bind(sessionId, raiderId, itemLevel, Date.now(), seasonId),
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

/**
 * A raider's Need/Dibs eligibility derived from their wins, ignoring one item (the one being
 * re-awarded). Used to demote runner-ups who have won with Need/Dibs since they rolled.
 */
export async function raiderEligibility(
  db: D1Database,
  sessionId: number,
  raiderId: number,
  excludeItemId: number,
): Promise<{ needAvailable: boolean; canDibs: boolean }> {
  const row = await db
    .prepare(
      `SELECT
         MAX(0, (SELECT se.need_per_session FROM seasons se JOIN sessions s ON s.season_id = se.id WHERE s.id = ?1)
           - (SELECT COUNT(*) FROM items i JOIN bosses b ON b.id = i.boss_id
              WHERE b.session_id = ?1 AND i.winner_raider_id = ?2 AND i.id != ?3 AND i.win_tier IN ('need','dibs'))) AS need_remaining,
         MAX(0, (SELECT se.dibs_per_season FROM seasons se JOIN sessions s ON s.season_id = se.id WHERE s.id = ?1)
           - (SELECT COUNT(*) FROM items i JOIN bosses b ON b.id = i.boss_id JOIN sessions s ON s.id = b.session_id
              WHERE s.season_id = (SELECT season_id FROM sessions WHERE id = ?1)
                AND i.winner_raider_id = ?2 AND i.id != ?3 AND i.win_tier = 'dibs')) AS dibs_remaining`,
    )
    .bind(sessionId, raiderId, excludeItemId)
    .first<{ need_remaining: number; dibs_remaining: number }>();
  const needRemaining = row?.need_remaining ?? 0;
  const dibsRemaining = row?.dibs_remaining ?? 0;
  return { needAvailable: needRemaining > 0, canDibs: dibsRemaining > 0 && needRemaining > 0 };
}

export async function setSessionStatus(db: D1Database, sessionId: number, status: Session['status']) {
  await db.prepare('UPDATE sessions SET status = ? WHERE id = ?').bind(status, sessionId).run();
}
