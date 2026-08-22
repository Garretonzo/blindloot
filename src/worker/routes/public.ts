import { Hono } from 'hono';
import { Env } from '../env';
import { getSessionDetail, getSessionRaiders, joinSession, LAST_ILVL_SQL } from '../db';
import { hasSiteAccess, isAdmin, requireSite, setSiteCookie, siteGateEnabled } from '../auth';
import { checkLogin, notifySession, presenceStub, sessionStub } from '../session';
import { canDibs, Tier, TIER_RANK } from '../../shared/types';

export const publicRoutes = new Hono<{ Bindings: Env }>();

// ---- site gate (before everything else) ----
publicRoutes.get('/site/me', async (c) => c.json({ ok: await hasSiteAccess(c), gated: siteGateEnabled(c.env) }));

publicRoutes.post('/site/login', async (c) => {
  const { password } = await c.req.json<{ password?: string }>();
  if (!siteGateEnabled(c.env)) return c.json({ ok: true });
  if (!password || password !== c.env.SITE_PASSWORD) return c.json({ error: 'wrong password' }, 401);
  await setSiteCookie(c);
  return c.json({ ok: true });
});

publicRoutes.use('*', requireSite);

publicRoutes.get('/seasons', async (c) => {
  const seasons = await c.env.DB.prepare('SELECT * FROM seasons ORDER BY created_at DESC').all();
  const sessions = await c.env.DB.prepare('SELECT * FROM sessions ORDER BY created_at DESC').all();
  return c.json({ seasons: seasons.results, sessions: sessions.results });
});

publicRoutes.get('/sessions/:id', async (c) => {
  const detail = await getSessionDetail(c.env.DB, Number(c.req.param('id')));
  if (!detail) return c.json({ error: 'not found' }, 404);
  if (await isAdmin(c)) return c.json(detail);

  // Raiders see who won (not how) and everyone's item level, but only their own Need / Dibs state.
  const meId = Number(c.req.query('raiderId')) || null;
  return c.json({
    ...detail,
    bosses: detail.bosses.map((b) => ({ ...b, items: b.items.map((i) => ({ ...i, win_tier: null })) })),
    raiders: detail.raiders.map((r) => (r.id === meId ? r : { ...r, has_dibs: false, need_available: false, dibs_locked: false })),
  });
});

// ---- pre-planned rolls ----
publicRoutes.get('/sessions/:id/plans', async (c) => {
  const sessionId = Number(c.req.param('id'));
  const raiderId = Number(c.req.query('raiderId'));
  if (!raiderId) return c.json({});
  const rows = await c.env.DB.prepare('SELECT item_id, tier FROM plans WHERE session_id = ? AND raider_id = ?')
    .bind(sessionId, raiderId)
    .all<{ item_id: number; tier: Tier }>();
  const out: Record<number, Tier> = {};
  for (const r of rows.results) out[r.item_id] = r.tier;
  return c.json(out);
});

publicRoutes.put('/sessions/:id/plans', async (c) => {
  const sessionId = Number(c.req.param('id'));
  const body = await c.req.json<{ raiderId?: number; token?: string; itemId?: number; tier?: Tier | null }>();
  const raiderId = Number(body.raiderId);
  const itemId = Number(body.itemId);
  if (!raiderId || !itemId) return c.json({ error: 'raiderId and itemId required' }, 400);
  if (!(await checkLogin(c.env, raiderId, body.token ?? ''))) return c.json({ error: 'not logged in' }, 401);
  const tier = body.tier ?? null;
  if (tier && !(tier in TIER_RANK)) return c.json({ error: 'bad tier' }, 400);

  const db = c.env.DB;
  const item = await db
    .prepare('SELECT i.resolved_at FROM items i JOIN bosses b ON b.id = i.boss_id WHERE i.id = ? AND b.session_id = ?')
    .bind(itemId, sessionId)
    .first<{ resolved_at: number | null }>();
  if (!item) return c.json({ error: 'item not found' }, 404);
  if (item.resolved_at != null) return c.json({ error: 'item already rolled' }, 409);

  const me = (await getSessionRaiders(db, sessionId)).find((r) => r.id === raiderId);
  if (!me) return c.json({ error: 'not in this session' }, 403);
  if (tier === 'need' && !me.need_available) return c.json({ error: 'Need roll already used' }, 409);
  if (tier === 'dibs' && !canDibs(me))
    return c.json({ error: me.dibs_locked ? 'Dibs is locked this session (you won with Need)' : 'Your Dibs is already used this season' }, 409);

  if (tier) {
    await db
      .prepare(
        `INSERT INTO plans (session_id, item_id, raider_id, tier) VALUES (?, ?, ?, ?)
         ON CONFLICT(item_id, raider_id) DO UPDATE SET tier = excluded.tier`,
      )
      .bind(sessionId, itemId, raiderId, tier)
      .run();
  } else {
    await db.prepare('DELETE FROM plans WHERE item_id = ? AND raider_id = ?').bind(itemId, raiderId).run();
  }
  return c.json({ ok: true });
});

// ---- login: pick a roster name; presence tracks who is logged in ----
publicRoutes.get('/raiders', async (c) => {
  const rows = await c.env.DB.prepare('SELECT id, username FROM raiders ORDER BY username COLLATE NOCASE').all();
  return c.json(rows.results);
});

publicRoutes.get('/presence', async (c) => {
  const res = await presenceStub(c.env).fetch('https://do/online');
  return c.json(await res.json());
});

publicRoutes.post('/login', async (c) => {
  const { raiderId } = await c.req.json<{ raiderId?: number }>();
  const raider = await c.env.DB.prepare('SELECT id, username FROM raiders WHERE id = ?').bind(Number(raiderId)).first<{ id: number; username: string }>();
  if (!raider) return c.json({ error: 'raider not found' }, 404);
  const res = await presenceStub(c.env).fetch('https://do/login', {
    method: 'POST',
    body: JSON.stringify({ raiderId: raider.id, username: raider.username }),
  });
  return c.json(await res.json(), res.status as 200);
});

publicRoutes.get('/login/check', async (c) => {
  const ok = await checkLogin(c.env, Number(c.req.query('raiderId')), c.req.query('token') ?? '');
  return c.json({ ok });
});

publicRoutes.post('/logout', async (c) => {
  const { raiderId, token } = await c.req.json<{ raiderId?: number; token?: string }>();
  await presenceStub(c.env).fetch(`https://do/logout?raiderId=${Number(raiderId)}&token=${encodeURIComponent(token ?? '')}`, { method: 'POST' });
  return c.json({ ok: true });
});

publicRoutes.get('/presence/ws', async (c) => {
  if (c.req.header('Upgrade') !== 'websocket') return c.text('expected websocket', 426);
  const url = new URL(c.req.url);
  const target = new URL('https://do/ws');
  for (const k of ['raiderId', 'token']) {
    const v = url.searchParams.get(k);
    if (v) target.searchParams.set(k, v);
  }
  const headers = new Headers(c.req.raw.headers);
  headers.set('X-Admin', (await isAdmin(c)) ? '1' : '0');
  return presenceStub(c.env).fetch(new Request(target, { headers }));
});

/** A raider's per-season record: Dibs status and their most recent item level in that season. */
publicRoutes.get('/raiders/:id/seasons', async (c) => {
  const raiderId = Number(c.req.param('id'));
  const rows = await c.env.DB.prepare(
    `SELECT sr.season_id, sr.has_dibs, ${LAST_ILVL_SQL.replace('ssr.raider_id = ?', 'ssr.raider_id = sr.raider_id').replace('s.season_id = ?', 's.season_id = sr.season_id')} AS last_item_level
     FROM season_raiders sr WHERE sr.raider_id = ?`,
  )
    .bind(raiderId)
    .all<{ season_id: number; has_dibs: number; last_item_level: number }>();
  return c.json(rows.results.map((r) => ({ seasonId: r.season_id, hasDibs: !!r.has_dibs, lastItemLevel: r.last_item_level })));
});

publicRoutes.post('/sessions/:id/join', async (c) => {
  const sessionId = Number(c.req.param('id'));
  const body = await c.req.json<{ raiderId?: number; token?: string; itemLevel?: number }>();
  const raiderId = Number(body.raiderId);
  const itemLevel = Math.max(0, Math.floor(Number(body.itemLevel ?? 0)));
  if (!raiderId) return c.json({ error: 'raiderId required' }, 400);
  if (!(await checkLogin(c.env, raiderId, body.token ?? ''))) return c.json({ error: 'not logged in' }, 401);

  const session = await c.env.DB.prepare('SELECT * FROM sessions WHERE id = ?')
    .bind(sessionId)
    .first<{ id: number; season_id: number; status: string }>();
  if (!session) return c.json({ error: 'not found' }, 404);
  if (session.status !== 'open') return c.json({ error: 'session is not accepting raiders right now' }, 409);

  const db = c.env.DB;
  const raider = await db.prepare('SELECT id, username FROM raiders WHERE id = ?').bind(raiderId).first<{ id: number; username: string }>();
  if (!raider) return c.json({ error: 'unknown raider — set your name first' }, 404);

  await joinSession(db, sessionId, session.season_id, raider.id, itemLevel);
  await notifySession(c.env, sessionId);
  return c.json({ raiderId: raider.id, username: raider.username });
});

publicRoutes.get('/sessions/:id/ws', async (c) => {
  if (c.req.header('Upgrade') !== 'websocket') return c.text('expected websocket', 426);
  const sessionId = Number(c.req.param('id'));
  const url = new URL(c.req.url);
  const target = new URL('https://do/ws');
  target.searchParams.set('sessionId', String(sessionId));
  const raiderId = url.searchParams.get('raiderId');
  // Only a logged-in raider gets a raider socket; otherwise they connect as a viewer.
  if (raiderId && (await checkLogin(c.env, Number(raiderId), url.searchParams.get('token') ?? ''))) {
    target.searchParams.set('raiderId', raiderId);
  }

  const headers = new Headers(c.req.raw.headers);
  headers.set('X-Admin', (await isAdmin(c)) ? '1' : '0');
  return sessionStub(c.env, sessionId).fetch(new Request(target, { headers }));
});
