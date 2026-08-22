import { Hono } from 'hono';
import { Env } from '../env';
import { clearAdminCookie, getRole, requireAdmin, requireSuper, roleForPassword, setAdminCookie } from '../auth';
import { clearSession, notifySession, presenceStub, sessionStub } from '../session';
import { getSessionRolls, joinSession, LAST_ILVL_SQL, raiderEligibility, recomputeRaiderResources, setItemLevelStatements, upsertRaider } from '../db';
import { demoteTier, Tier } from '../../shared/types';
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

// ---- seasons ----
adminRoutes.post('/seasons', async (c) => {
  const { name, raidId } = await c.req.json<{ name?: string; raidId?: string }>();
  if (!name?.trim()) return c.json({ error: 'name required' }, 400);
  if (!raidId || !raidById(raidId)) return c.json({ error: 'unknown boss/loot pool' }, 400);
  const r = await c.env.DB.prepare('INSERT INTO seasons (name, raid_id, created_at) VALUES (?, ?, ?) RETURNING *')
    .bind(name.trim(), raidId, Date.now())
    .first();
  return c.json(r);
});

adminRoutes.patch('/seasons/:id', async (c) => {
  const { name } = await c.req.json<{ name?: string }>();
  if (!name?.trim()) return c.json({ error: 'name required' }, 400);
  await c.env.DB.prepare('UPDATE seasons SET name = ? WHERE id = ?').bind(name.trim(), Number(c.req.param('id'))).run();
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
      `SELECT r.id, r.username, sr.has_dibs,
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
  await notifySession(c.env, sessionId);
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
  await notifySession(c.env, sessionId);
  return c.json({ ok: true });
});

adminRoutes.delete('/sessions/:id/items/:itemId', async (c) => {
  const sessionId = Number(c.req.param('id'));
  const itemId = Number(c.req.param('itemId'));
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM rolls WHERE item_id = ?').bind(itemId),
    c.env.DB.prepare('DELETE FROM plans WHERE item_id = ?').bind(itemId),
    c.env.DB.prepare('DELETE FROM items WHERE id = ?').bind(itemId),
  ]);
  await notifySession(c.env, sessionId);
  return c.json({ ok: true });
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
      if (!e.tier || e.tier === 'greed' || e.tier === 'equip') {
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
    db.prepare('UPDATE items SET winner_raider_id = ?, win_tier = ?, resolved_at = COALESCE(resolved_at, ?) WHERE id = ?').bind(raiderId, tier, Date.now(), itemId),
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
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM rolls WHERE item_id IN (SELECT id FROM items WHERE boss_id = ?)').bind(bossId),
    c.env.DB.prepare('DELETE FROM plans WHERE item_id IN (SELECT id FROM items WHERE boss_id = ?)').bind(bossId),
    c.env.DB.prepare('DELETE FROM items WHERE boss_id = ?').bind(bossId),
    c.env.DB.prepare('DELETE FROM bosses WHERE id = ?').bind(bossId),
  ]);
  await notifySession(c.env, sessionId);
  return c.json({ ok: true });
});

// ---- site-wide raider roster ----
adminRoutes.get('/raiders', async (c) => {
  const rows = await c.env.DB.prepare('SELECT id, username, created_at FROM raiders ORDER BY username COLLATE NOCASE').all();
  return c.json(rows.results);
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
    hasDibs?: boolean;
    needAvailable?: boolean;
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
  if (body.hasDibs != null) {
    stmts.push(
      db
        .prepare('UPDATE season_raiders SET has_dibs = ? WHERE season_id = ? AND raider_id = ?')
        .bind(body.hasDibs ? 1 : 0, session.season_id, raiderId),
    );
  }
  if (body.needAvailable != null) {
    stmts.push(
      db
        .prepare('UPDATE session_raiders SET need_available = ? WHERE session_id = ? AND raider_id = ?')
        .bind(body.needAvailable ? 1 : 0, sessionId, raiderId),
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
