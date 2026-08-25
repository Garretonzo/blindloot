import { Hono } from 'hono';
import { Env } from '../env';
import { clearAdminCookie, getRole, requireAdmin, requireSuper, roleForPassword, setAdminCookie } from '../auth';
import { clearSession, notifySession, presenceStub, resetSessionLive, sessionStub } from '../session';
import {
  BackupKind,
  deleteBackup,
  listBackups,
  loadBackup,
  loadBackupJson,
  MAX_TOTAL_BACKUP_BYTES,
  restoreSnapshot,
  Snapshot,
  storeBackup,
  takeSnapshot,
  totalBackupBytes,
  validateSnapshot,
} from '../backup';
import {
  getSessionRolls,
  joinSession,
  LAST_ILVL_SQL,
  raiderEligibility,
  recomputeRaiderResources,
  recomputeSeasonResources,
  setItemLevelStatements,
  upsertRaider,
} from '../db';
import { demoteTier, SummaryItem, Tier } from '../../shared/types';
import { raidById } from '../../shared/raids';

export const adminRoutes = new Hono<{ Bindings: Env }>();

adminRoutes.post('/login', async (c) => {
  const { password } = await c.req.json<{ password?: string }>();
  const role = password ? roleForPassword(c.env, password) : null;
  if (!role) return c.json({ error: 'wrong password' }, 401);
  await setAdminCookie(c, role);
  return c.json({ ok: true, role });
});

adminRoutes.post('/logout', (c) => {
  clearAdminCookie(c);
  return c.json({ ok: true });
});

adminRoutes.get('/me', async (c) => {
  const role = await getRole(c);
  return c.json({ admin: role != null, super: role === 'super' });
});

adminRoutes.use('*', requireAdmin);

// ---- super admin: destructive ----
function sessionDeleteStatements(db: D1Database, sessionId: number): D1PreparedStatement[] {
  return [
    db.prepare('DELETE FROM rolls WHERE item_id IN (SELECT i.id FROM items i JOIN bosses b ON b.id = i.boss_id WHERE b.session_id = ?)').bind(sessionId),
    db.prepare('DELETE FROM plans WHERE session_id = ?').bind(sessionId),
    db.prepare('DELETE FROM items WHERE boss_id IN (SELECT id FROM bosses WHERE session_id = ?)').bind(sessionId),
    db.prepare('DELETE FROM bosses WHERE session_id = ?').bind(sessionId),
    db.prepare('DELETE FROM session_raiders WHERE session_id = ?').bind(sessionId),
    db.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId),
  ];
}

adminRoutes.delete('/sessions/:id', requireSuper, async (c) => {
  const sessionId = Number(c.req.param('id'));
  await c.env.DB.batch(sessionDeleteStatements(c.env.DB, sessionId));
  await clearSession(c.env, sessionId);
  return c.json({ ok: true });
});

adminRoutes.delete('/seasons/:id', requireSuper, async (c) => {
  const seasonId = Number(c.req.param('id'));
  const db = c.env.DB;
  const sessions = await db.prepare('SELECT id FROM sessions WHERE season_id = ?').bind(seasonId).all<{ id: number }>();
  const stmts = sessions.results.flatMap((s) => sessionDeleteStatements(db, s.id));
  stmts.push(db.prepare('DELETE FROM season_raiders WHERE season_id = ?').bind(seasonId));
  stmts.push(db.prepare('DELETE FROM seasons WHERE id = ?').bind(seasonId));
  await db.batch(stmts);
  for (const s of sessions.results) await clearSession(c.env, s.id);
  return c.json({ ok: true });
});

// ---- super admin: restore points + export/import ----

const exportHeaders = (createdAt: number) => ({
  'content-type': 'application/json',
  'content-disposition': `attachment; filename="jfr-backup-${new Date(createdAt).toISOString().slice(0, 10)}.json"`,
});

/**
 * Replace all data with a snapshot, after saving an automatic safety backup of the
 * current state. Then reconcile the Durable Objects, which may hold live roll-off state
 * that no longer matches D1. DO resets are kept to the handful of sessions that can
 * actually hold live state (each reset is a subrequest, capped per invocation): sessions
 * restored as non-closed, and sessions that were mid-roll-off before the restore. Idle
 * viewers of other old sessions simply see fresh data on their next page load.
 */
async function performRestore(env: Env, snap: Snapshot, kind: Exclude<BackupKind, 'manual'>, backupName: string) {
  const db = env.DB;
  const pre = await db.prepare('SELECT id, status FROM sessions').all<{ id: number; status: string }>();
  const preRaiders = await db.prepare('SELECT id FROM raiders').all<{ id: number }>();
  const preBackup = await storeBackup(db, backupName, kind, await takeSnapshot(db));

  await restoreSnapshot(db, snap);

  const post = new Map(snap.tables.sessions.map((s) => [Number(s.id), String(s.status)]));
  const wasLive = new Set(pre.results.filter((s) => s.status === 'staging' || s.status === 'rolling').map((s) => s.id));
  for (const s of pre.results) if (!post.has(s.id)) await clearSession(env, s.id);
  for (const [id, status] of post) {
    if (status !== 'closed') await resetSessionLive(env, id, 'open');
    else if (wasLive.has(id)) await resetSessionLive(env, id, 'closed');
  }

  if (kind === 'pre-import') {
    // Foreign snapshot: raider ids may now mean different people, so end every login.
    await presenceStub(env).fetch('https://do/end-all', { method: 'POST' });
  } else {
    const postRaiders = new Set(snap.tables.raiders.map((r) => Number(r.id)));
    for (const r of preRaiders.results) {
      if (!postRaiders.has(r.id)) await presenceStub(env).fetch(`https://do/end?raiderId=${r.id}`, { method: 'POST' });
    }
  }
  return preBackup;
}

adminRoutes.get('/backups', requireSuper, async (c) => c.json(await listBackups(c.env.DB)));

adminRoutes.post('/backups', requireSuper, async (c) => {
  const { name } = await c.req.json<{ name?: string }>().catch(() => ({ name: undefined }));
  const label = (name ?? '').trim().slice(0, 60) || new Date().toISOString().slice(0, 16).replace('T', ' ');
  if ((await totalBackupBytes(c.env.DB)) > MAX_TOTAL_BACKUP_BYTES) {
    return c.json({ error: 'backup storage is full; delete old restore points first' }, 409);
  }
  const meta = await storeBackup(c.env.DB, label, 'manual', await takeSnapshot(c.env.DB));
  return c.json(meta);
});

adminRoutes.delete('/backups/:id', requireSuper, async (c) => {
  await deleteBackup(c.env.DB, Number(c.req.param('id')));
  return c.json({ ok: true });
});

adminRoutes.post('/backups/:id/restore', requireSuper, async (c) => {
  const id = Number(c.req.param('id'));
  const source = await c.env.DB.prepare('SELECT name FROM backups WHERE id = ?').bind(id).first<{ name: string }>();
  if (!source) return c.json({ error: 'restore point not found' }, 404);
  const snap = await loadBackup(c.env.DB, id);
  if (!snap) return c.json({ error: 'restore point not found' }, 404);
  const preBackup = await performRestore(c.env, snap, 'pre-restore', `before restoring "${source.name}"`);
  return c.json({ ok: true, preBackupId: preBackup.id });
});

/** Download the current data as a backup file. */
adminRoutes.get('/export', requireSuper, async (c) => {
  const snap = await takeSnapshot(c.env.DB);
  return new Response(JSON.stringify(snap), { headers: exportHeaders(snap.createdAt) });
});

/** Download a stored restore point as a backup file. */
adminRoutes.get('/backups/:id/export', requireSuper, async (c) => {
  const id = Number(c.req.param('id'));
  const meta = await c.env.DB.prepare('SELECT created_at FROM backups WHERE id = ?').bind(id).first<{ created_at: number }>();
  const json = meta ? await loadBackupJson(c.env.DB, id) : null;
  if (json == null) return c.json({ error: 'restore point not found' }, 404);
  return new Response(json, { headers: exportHeaders(meta!.created_at) });
});

/** Upload a backup file and replace everything with it (a pre-import restore point is saved first). */
adminRoutes.post('/import', requireSuper, async (c) => {
  const len = Number(c.req.header('content-length') ?? 0);
  if (len > 25 * 1024 * 1024) return c.json({ error: 'file too large' }, 413);
  let snap: Snapshot;
  try {
    const body: unknown = JSON.parse(await c.req.text());
    validateSnapshot(body);
    snap = body;
  } catch (e) {
    return c.json({ error: `invalid backup file: ${(e as Error).message}` }, 400);
  }
  const preBackup = await performRestore(c.env, snap, 'pre-import', 'before import');
  return c.json({ ok: true, preBackupId: preBackup.id });
});

// ---- seasons ----
/** Charge limits are small non-negative counts; anything else falls back to null (= not provided). */
const parseLimit = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(99, Math.max(0, n)) : null;
};

adminRoutes.post('/seasons', async (c) => {
  const { name, raidId, dibsPerSeason, needPerSession } = await c.req.json<{
    name?: string;
    raidId?: string;
    dibsPerSeason?: number;
    needPerSession?: number;
  }>();
  if (!name?.trim()) return c.json({ error: 'name required' }, 400);
  if (!raidId || !raidById(raidId)) return c.json({ error: 'unknown boss/loot pool' }, 400);
  const r = await c.env.DB.prepare(
    'INSERT INTO seasons (name, raid_id, created_at, dibs_per_season, need_per_session) VALUES (?, ?, ?, ?, ?) RETURNING *',
  )
    .bind(name.trim(), raidId, Date.now(), parseLimit(dibsPerSeason) ?? 1, parseLimit(needPerSession) ?? 1)
    .first();
  return c.json(r);
});

adminRoutes.patch('/seasons/:id', async (c) => {
  const seasonId = Number(c.req.param('id'));
  const body = await c.req.json<{ name?: string; dibsPerSeason?: number; needPerSession?: number }>();
  const dibs = parseLimit(body.dibsPerSeason);
  const need = parseLimit(body.needPerSession);
  if (!body.name?.trim() && dibs == null && need == null) return c.json({ error: 'nothing to update' }, 400);
  const db = c.env.DB;
  const stmts: D1PreparedStatement[] = [];
  if (body.name?.trim()) stmts.push(db.prepare('UPDATE seasons SET name = ? WHERE id = ?').bind(body.name.trim(), seasonId));
  if (dibs != null) stmts.push(db.prepare('UPDATE seasons SET dibs_per_season = ? WHERE id = ?').bind(dibs, seasonId));
  if (need != null) stmts.push(db.prepare('UPDATE seasons SET need_per_session = ? WHERE id = ?').bind(need, seasonId));
  // A limit change applies retroactively: remaining = new limit - wins already recorded.
  if (dibs != null || need != null) stmts.push(...recomputeSeasonResources(db, seasonId));
  await db.batch(stmts);
  if (dibs != null || need != null) {
    const sessions = await db.prepare('SELECT id FROM sessions WHERE season_id = ?').bind(seasonId).all<{ id: number }>();
    for (const s of sessions.results) await notifySession(c.env, s.id);
  }
  return c.json({ ok: true });
});

adminRoutes.patch('/sessions/:id', async (c) => {
  const sessionId = Number(c.req.param('id'));
  const { name } = await c.req.json<{ name?: string }>();
  if (!name?.trim()) return c.json({ error: 'name required' }, 400);
  await c.env.DB.prepare('UPDATE sessions SET name = ? WHERE id = ?').bind(name.trim(), sessionId).run();
  await notifySession(c.env, sessionId);
  return c.json({ ok: true });
});

adminRoutes.get('/seasons/:id/history', async (c) => {
  const seasonId = Number(c.req.param('id'));
  const db = c.env.DB;
  const sessions = await db.prepare('SELECT * FROM sessions WHERE season_id = ? ORDER BY created_at').bind(seasonId).all();
  const items = await db
    .prepare(
      `SELECT s.id AS session_id, b.name AS boss_name, i.id AS item_id, i.name AS item_name,
              i.win_tier, r.username AS winner
       FROM sessions s JOIN bosses b ON b.session_id = s.id JOIN items i ON i.boss_id = b.id
       LEFT JOIN raiders r ON r.id = i.winner_raider_id
       WHERE s.season_id = ? ORDER BY s.created_at, b.sort_order, b.id, i.sort_order, i.id`,
    )
    .bind(seasonId)
    .all();
  const rolls = await db
    .prepare(
      `SELECT ro.item_id, r.username, ro.tier, ro.roll_value, ro.won
       FROM rolls ro JOIN raiders r ON r.id = ro.raider_id
       JOIN items i ON i.id = ro.item_id JOIN bosses b ON b.id = i.boss_id JOIN sessions s ON s.id = b.session_id
       WHERE s.season_id = ? ORDER BY ro.id`,
    )
    .bind(seasonId)
    .all();
  const raiders = await db
    .prepare(
      `SELECT r.id, r.username, sr.dibs_remaining,
              ${LAST_ILVL_SQL.replace('ssr.raider_id = ?', 'ssr.raider_id = sr.raider_id').replace('s.season_id = ?', 's.season_id = sr.season_id')} AS item_level
       FROM season_raiders sr JOIN raiders r ON r.id = sr.raider_id
       WHERE sr.season_id = ? ORDER BY r.username`,
    )
    .bind(seasonId)
    .all();
  return c.json({ sessions: sessions.results, items: items.results, rolls: rolls.results, raiders: raiders.results });
});

// ---- sessions ----
adminRoutes.post('/sessions', async (c) => {
  const { seasonId, name } = await c.req.json<{ seasonId?: number; name?: string }>();
  if (!seasonId || !name?.trim()) return c.json({ error: 'seasonId and name required' }, 400);
  const r = await c.env.DB.prepare(
    'INSERT INTO sessions (season_id, name, status, created_at) VALUES (?, ?, ?, ?) RETURNING *',
  )
    .bind(seasonId, name.trim(), 'open', Date.now())
    .first();
  return c.json(r);
});

adminRoutes.post('/sessions/:id/bosses', async (c) => {
  const sessionId = Number(c.req.param('id'));
  const { name, icon, items } = await c.req.json<{ name?: string; icon?: string | null; items?: (string | { name: string; icon?: string | null })[] }>();
  if (!name?.trim()) return c.json({ error: 'boss name required' }, 400);
  const db = c.env.DB;
  const order = await db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM bosses WHERE session_id = ?')
    .bind(sessionId)
    .first<{ n: number }>();
  const boss = await db.prepare('INSERT INTO bosses (session_id, name, icon, sort_order) VALUES (?, ?, ?, ?) RETURNING id')
    .bind(sessionId, name.trim(), icon ?? null, order?.n ?? 1)
    .first<{ id: number }>();
  const list = (items ?? [])
    .map((it) => (typeof it === 'string' ? { name: it.trim(), icon: null } : { name: it.name?.trim() ?? '', icon: it.icon ?? null }))
    .filter((it) => it.name);
  if (list.length) {
    await db.batch(
      list.map((it, i) =>
        db.prepare('INSERT INTO items (boss_id, name, icon, sort_order) VALUES (?, ?, ?, ?)').bind(boss!.id, it.name, it.icon, i + 1),
      ),
    );
  }
  await notifySession(c.env, sessionId, true);
  return c.json({ ok: true });
});

adminRoutes.post('/sessions/:id/bosses/:bossId/items', async (c) => {
  const sessionId = Number(c.req.param('id'));
  const bossId = Number(c.req.param('bossId'));
  const { name, icon } = await c.req.json<{ name?: string; icon?: string | null }>();
  if (!name?.trim()) return c.json({ error: 'name required' }, 400);
  const db = c.env.DB;
  const order = await db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM items WHERE boss_id = ?')
    .bind(bossId)
    .first<{ n: number }>();
  await db.prepare('INSERT INTO items (boss_id, name, icon, sort_order) VALUES (?, ?, ?, ?)')
    .bind(bossId, name.trim(), icon ?? null, order?.n ?? 1)
    .run();
  await notifySession(c.env, sessionId, true);
  return c.json({ ok: true });
});

/**
 * History-safe deletion gate: anyone with admin can delete loot that has no recorded
 * rolls (fixing a typo loses nothing), but destroying roll history takes the super admin.
 */
async function requireSuperIfHistory(c: Parameters<typeof getRole>[0], rollCount: number): Promise<Response | null> {
  if (rollCount > 0 && (await getRole(c)) !== 'super') {
    return c.json({ error: 'this would delete roll history; super admin required' }, 403);
  }
  return null;
}

adminRoutes.delete('/sessions/:id/items/:itemId', async (c) => {
  const sessionId = Number(c.req.param('id'));
  const itemId = Number(c.req.param('itemId'));
  const rolls = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM rolls WHERE item_id = ?').bind(itemId).first<{ n: number }>();
  const denied = await requireSuperIfHistory(c, rolls?.n ?? 0);
  if (denied) return denied;
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM rolls WHERE item_id = ?').bind(itemId),
    c.env.DB.prepare('DELETE FROM plans WHERE item_id = ?').bind(itemId),
    c.env.DB.prepare('DELETE FROM items WHERE id = ?').bind(itemId),
  ]);
  await notifySession(c.env, sessionId, true);
  return c.json({ ok: true });
});

/** The session's full loot story: every resolved item in order with everyone's pick, roll and outcome. */
adminRoutes.get('/sessions/:id/summary', async (c) => {
  const sessionId = Number(c.req.param('id'));
  const db = c.env.DB;
  const items = await db
    .prepare(
      `SELECT i.id, i.name, i.icon, b.name AS boss_name, b.icon AS boss_icon, i.resolved_mode, i.winner_raider_id, i.win_tier, w.username AS winner_name
       FROM items i JOIN bosses b ON b.id = i.boss_id LEFT JOIN raiders w ON w.id = i.winner_raider_id
       WHERE b.session_id = ? AND i.resolved_at IS NOT NULL ORDER BY i.resolved_at, i.id`,
    )
    .bind(sessionId)
    .all<{ id: number; name: string; icon: string | null; boss_name: string; boss_icon: string | null; resolved_mode: SummaryItem['mode']; winner_raider_id: number | null; win_tier: Tier | null; winner_name: string | null }>();
  const rolls = await getSessionRolls(db, sessionId);
  const picked = await db
    .prepare(
      `SELECT ro.item_id, ro.raider_id, ro.picked_tier FROM rolls ro JOIN items i ON i.id = ro.item_id JOIN bosses b ON b.id = i.boss_id WHERE b.session_id = ?`,
    )
    .bind(sessionId)
    .all<{ item_id: number; raider_id: number; picked_tier: Tier | null }>();
  const pickedBy = new Map(picked.results.map((r) => [`${r.item_id}:${r.raider_id}`, r.picked_tier]));
  const out: SummaryItem[] = items.results.map((i, idx) => ({
    itemId: i.id,
    name: i.name,
    icon: i.icon,
    bossName: i.boss_name,
    bossIcon: i.boss_icon,
    order: idx + 1,
    mode: i.resolved_mode,
    winnerId: i.winner_raider_id,
    winnerName: i.winner_name,
    winTier: i.win_tier,
    entries: (rolls[i.id] ?? []).map((e) => ({ ...e, pickedTier: pickedBy.get(`${i.id}:${e.raiderId}`) ?? null })),
  }));
  return c.json({ items: out });
});

/** Every raider's pre-pick on every unresolved item, with what it will actually count as. Admin only. */
adminRoutes.get('/sessions/:id/plans', async (c) => {
  const sessionId = Number(c.req.param('id'));
  const db = c.env.DB;
  const rows = await db
    .prepare(
      `SELECT p.item_id, p.raider_id, r.username, p.tier FROM plans p
       JOIN items i ON i.id = p.item_id JOIN raiders r ON r.id = p.raider_id
       WHERE p.session_id = ? AND i.resolved_at IS NULL ORDER BY p.item_id, r.username COLLATE NOCASE`,
    )
    .bind(sessionId)
    .all<{ item_id: number; raider_id: number; username: string; tier: Tier }>();
  const elig = new Map<number, { needAvailable: boolean; canDibs: boolean }>();
  const out: Record<number, { raiderId: number; username: string; tier: Tier; effectiveTier: Tier }[]> = {};
  for (const p of rows.results) {
    let e = elig.get(p.raider_id);
    if (!e) {
      e = await raiderEligibility(db, sessionId, p.raider_id, 0);
      elig.set(p.raider_id, e);
    }
    (out[p.item_id] ??= []).push({ raiderId: p.raider_id, username: p.username, tier: p.tier, effectiveTier: demoteTier(p.tier, e) });
  }
  return c.json(out);
});

/** Who has pre-picked how many unresolved items — shown before running an instant batch. */
adminRoutes.get('/sessions/:id/plans-summary', async (c) => {
  const sessionId = Number(c.req.param('id'));
  const db = c.env.DB;
  const picks = await db
    .prepare(
      `SELECT p.raider_id, COUNT(*) AS n FROM plans p JOIN items i ON i.id = p.item_id
       WHERE p.session_id = ? AND i.resolved_at IS NULL GROUP BY p.raider_id`,
    )
    .bind(sessionId)
    .all<{ raider_id: number; n: number }>();
  const unresolved = await db
    .prepare('SELECT COUNT(*) AS n FROM items i JOIN bosses b ON b.id = i.boss_id WHERE b.session_id = ? AND i.resolved_at IS NULL')
    .bind(sessionId)
    .first<{ n: number }>();
  return c.json({ raiders: picks.results.map((r) => ({ raiderId: r.raider_id, picks: r.n })), unresolvedItems: unresolved?.n ?? 0 });
});

adminRoutes.get('/sessions/:id/rolls', async (c) => {
  const sessionId = Number(c.req.param('id'));
  const rolls = await getSessionRolls(c.env.DB, sessionId);
  // Annotate each roll with what it would count as today (runner-ups may have won Need/Dibs since).
  const cache = new Map<string, { needAvailable: boolean; canDibs: boolean }>();
  for (const [itemIdStr, entries] of Object.entries(rolls)) {
    const itemId = Number(itemIdStr);
    for (const e of entries) {
      if (!e.tier || (e.tier !== 'need' && e.tier !== 'dibs')) {
        e.effectiveTier = e.tier;
        e.ineligible = false;
        continue;
      }
      const key = `${itemId}:${e.raiderId}`;
      let el = cache.get(key);
      if (!el) {
        el = await raiderEligibility(c.env.DB, sessionId, e.raiderId, itemId);
        cache.set(key, el);
      }
      e.effectiveTier = demoteTier(e.tier, el);
      e.ineligible = e.effectiveTier !== e.tier;
    }
  }
  return c.json(rolls);
});

/** Manually (re)assign an item's winner, e.g. when the winner gives it away. */
adminRoutes.post('/sessions/:id/items/:itemId/award', async (c) => {
  const sessionId = Number(c.req.param('id'));
  const itemId = Number(c.req.param('itemId'));
  const body = await c.req.json<{ raiderId?: number | null; tier?: Tier | null; force?: boolean }>();
  const raiderId = body.raiderId ?? null;
  let tier: Tier | null = raiderId != null ? body.tier ?? 'greed' : null;
  const db = c.env.DB;
  // Unless the admin explicitly forces it, a Need/Dibs award is demoted if the raider has
  // already won with Need/Dibs elsewhere (ignoring this item, whose winner is being replaced).
  if (raiderId != null && tier && !body.force) {
    tier = demoteTier(tier, await raiderEligibility(db, sessionId, raiderId, itemId));
  }

  const item = await db
    .prepare('SELECT i.resolved_at, i.winner_raider_id, i.win_tier FROM items i JOIN bosses b ON b.id = i.boss_id WHERE i.id = ? AND b.session_id = ?')
    .bind(itemId, sessionId)
    .first<{ resolved_at: number | null; winner_raider_id: number | null; win_tier: Tier | null }>();
  if (!item) return c.json({ error: 'item not found' }, 404);
  const live = (await (await sessionStub(c.env, sessionId).fetch(`https://do/current-item?sessionId=${sessionId}`)).json()) as { itemId: number | null };
  if (live.itemId === itemId) return c.json({ error: 'item is being rolled right now' }, 409);

  const stmts: D1PreparedStatement[] = [
    db
      .prepare("UPDATE items SET winner_raider_id = ?, win_tier = ?, resolved_at = COALESCE(resolved_at, ?), resolved_mode = COALESCE(resolved_mode, 'award') WHERE id = ?")
      .bind(raiderId, tier, Date.now(), itemId),
    db.prepare('UPDATE rolls SET won = CASE WHEN raider_id = ? THEN 1 ELSE 0 END WHERE item_id = ?').bind(raiderId ?? -1, itemId),
    db.prepare('DELETE FROM plans WHERE item_id = ?').bind(itemId),
  ];
  // Then derive Need / Dibs state for everyone affected from what they have actually won.
  const affected = new Set<number>();
  if (item.winner_raider_id != null) affected.add(item.winner_raider_id);
  if (raiderId != null) affected.add(raiderId);
  for (const id of affected) stmts.push(...recomputeRaiderResources(db, sessionId, id));
  await db.batch(stmts);
  await notifySession(c.env, sessionId);
  return c.json({ ok: true, tier });
});

adminRoutes.delete('/sessions/:id/bosses/:bossId', async (c) => {
  const sessionId = Number(c.req.param('id'));
  const bossId = Number(c.req.param('bossId'));
  const rolls = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM rolls WHERE item_id IN (SELECT id FROM items WHERE boss_id = ?)')
    .bind(bossId)
    .first<{ n: number }>();
  const denied = await requireSuperIfHistory(c, rolls?.n ?? 0);
  if (denied) return denied;
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM rolls WHERE item_id IN (SELECT id FROM items WHERE boss_id = ?)').bind(bossId),
    c.env.DB.prepare('DELETE FROM plans WHERE item_id IN (SELECT id FROM items WHERE boss_id = ?)').bind(bossId),
    c.env.DB.prepare('DELETE FROM items WHERE boss_id = ?').bind(bossId),
    c.env.DB.prepare('DELETE FROM bosses WHERE id = ?').bind(bossId),
  ]);
  await notifySession(c.env, sessionId, true);
  return c.json({ ok: true });
});

// ---- site-wide raider roster ----
adminRoutes.get('/raiders', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT id, username, created_at, (password_hash IS NOT NULL) AS has_password FROM raiders ORDER BY username COLLATE NOCASE',
  ).all();
  return c.json(rows.results);
});

/** Reset a raider to passwordless (lockout recovery); their next login prompts them to set a new one. */
adminRoutes.delete('/raiders/:id/password', requireSuper, async (c) => {
  await c.env.DB.prepare('UPDATE raiders SET password_hash = NULL WHERE id = ?').bind(Number(c.req.param('id'))).run();
  return c.json({ ok: true });
});

adminRoutes.post('/raiders', async (c) => {
  const { username: raw } = await c.req.json<{ username?: string }>();
  const username = (raw ?? '').trim();
  if (!username || username.length > 32) return c.json({ error: 'invalid username' }, 400);
  const existing = await c.env.DB.prepare('SELECT id FROM raiders WHERE username = ?').bind(username).first<{ id: number }>();
  const raider = await upsertRaider(c.env.DB, username);
  if (!raider) return c.json({ error: 'failed' }, 500);
  return c.json({ ...raider, created: !existing });
});

adminRoutes.patch('/raiders/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const { username: raw } = await c.req.json<{ username?: string }>();
  const username = (raw ?? '').trim();
  if (!username || username.length > 32) return c.json({ error: 'invalid username' }, 400);
  try {
    await c.env.DB.prepare('UPDATE raiders SET username = ? WHERE id = ?').bind(username, id).run();
  } catch (e) {
    return c.json({ error: (e as Error).message.includes('UNIQUE') ? 'username taken' : 'update failed' }, 409);
  }
  return c.json({ ok: true });
});

/** End a raider's login; their browser is bounced back to the name picker. */
adminRoutes.delete('/logins/:raiderId', async (c) => {
  await presenceStub(c.env).fetch(`https://do/end?raiderId=${Number(c.req.param('raiderId'))}`, { method: 'POST' });
  return c.json({ ok: true });
});

adminRoutes.delete('/raiders/:id', requireSuper, async (c) => {
  const id = Number(c.req.param('id'));
  const used = await c.env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM session_raiders WHERE raider_id = ?) + (SELECT COUNT(*) FROM rolls WHERE raider_id = ?) AS n`,
  )
    .bind(id, id)
    .first<{ n: number }>();
  if ((used?.n ?? 0) > 0) return c.json({ error: 'raider has session history; remove them from sessions first' }, 409);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM season_raiders WHERE raider_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM plans WHERE raider_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM raiders WHERE id = ?').bind(id),
  ]);
  return c.json({ ok: true });
});

/** Admin adds a roster raider to a session with this session's item level. */
adminRoutes.post('/sessions/:id/raiders', async (c) => {
  const sessionId = Number(c.req.param('id'));
  const body = await c.req.json<{ raiderId?: number; itemLevel?: number }>();
  const raiderId = Number(body.raiderId);
  const itemLevel = Math.max(0, Math.floor(Number(body.itemLevel ?? 0)));
  if (!raiderId) return c.json({ error: 'raiderId required' }, 400);
  const db = c.env.DB;
  const session = await db.prepare('SELECT season_id FROM sessions WHERE id = ?').bind(sessionId).first<{ season_id: number }>();
  if (!session) return c.json({ error: 'not found' }, 404);
  const raider = await db.prepare('SELECT id, username FROM raiders WHERE id = ?').bind(raiderId).first<{ id: number; username: string }>();
  if (!raider) return c.json({ error: 'raider not found' }, 404);
  await joinSession(db, sessionId, session.season_id, raider.id, itemLevel);
  await notifySession(c.env, sessionId);
  return c.json({ raiderId: raider.id, username: raider.username });
});

adminRoutes.patch('/sessions/:id/raiders/:raiderId', async (c) => {
  const sessionId = Number(c.req.param('id'));
  const raiderId = Number(c.req.param('raiderId'));
  const body = await c.req.json<{
    username?: string;
    itemLevel?: number;
    dibsRemaining?: number;
    needRemaining?: number;
  }>();
  const db = c.env.DB;
  const session = await db.prepare('SELECT season_id FROM sessions WHERE id = ?')
    .bind(sessionId)
    .first<{ season_id: number }>();
  if (!session) return c.json({ error: 'not found' }, 404);

  const stmts: D1PreparedStatement[] = [];
  if (body.username?.trim()) {
    stmts.push(db.prepare('UPDATE raiders SET username = ? WHERE id = ?').bind(body.username.trim(), raiderId));
  }
  if (body.itemLevel != null) stmts.push(...setItemLevelStatements(db, sessionId, raiderId, Math.max(0, Math.floor(body.itemLevel))));
  const dibsRemaining = parseLimit(body.dibsRemaining);
  if (dibsRemaining != null) {
    stmts.push(
      db
        .prepare('UPDATE season_raiders SET dibs_remaining = ? WHERE season_id = ? AND raider_id = ?')
        .bind(dibsRemaining, session.season_id, raiderId),
    );
  }
  const needRemaining = parseLimit(body.needRemaining);
  if (needRemaining != null) {
    stmts.push(
      db
        .prepare('UPDATE session_raiders SET need_remaining = ? WHERE session_id = ? AND raider_id = ?')
        .bind(needRemaining, sessionId, raiderId),
    );
  }
  try {
    if (stmts.length) await db.batch(stmts);
  } catch (e) {
    return c.json({ error: (e as Error).message.includes('UNIQUE') ? 'username taken' : 'update failed' }, 400);
  }
  await notifySession(c.env, sessionId);
  return c.json({ ok: true });
});

adminRoutes.delete('/sessions/:id/raiders/:raiderId', async (c) => {
  const sessionId = Number(c.req.param('id'));
  const raiderId = Number(c.req.param('raiderId'));
  await c.env.DB.prepare('DELETE FROM session_raiders WHERE session_id = ? AND raider_id = ?')
    .bind(sessionId, raiderId)
    .run();
  await notifySession(c.env, sessionId);
  return c.json({ ok: true });
});

adminRoutes.get('/sessions/:id/live', async (c) => {
  const sessionId = Number(c.req.param('id'));
  const res = await sessionStub(c.env, sessionId).fetch(`https://do/state?sessionId=${sessionId}`);
  return new Response(res.body, { headers: { 'content-type': 'application/json' } });
});
