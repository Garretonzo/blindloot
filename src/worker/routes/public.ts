import { Hono } from 'hono';
import { AppEnv } from '../env';
import { getSessionRaider, hasRaiderWonCopy, joinSession, LAST_ILVL_SQL } from '../db';
import { hashPassword, hasSiteAccess, isAdmin, requireSite, setSiteCookie, siteGateEnabled, verifyPassword } from '../auth';
import { checkLogin, createLogin, deleteLogin, notifyPlansChanged, notifySession, presenceStub, raiderForToken, sessionStub } from '../session';
import { canDibs, SessionDetail, Tier, TIER_RANK } from '../../shared/types';
import { sanitizeDetail } from '../sanitize';

export const publicRoutes = new Hono<AppEnv>();

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

// Identity comes from the login token, never from a client-supplied raiderId. The SPA sends the
// token as a header; `?token=` covers WebSocket upgrades (browsers can't set headers there).
publicRoutes.use('*', async (c, next) => {
  const token = c.req.header('x-loot-token') || c.req.query('token') || '';
  c.set('authedRaiderId', token ? await raiderForToken(c.env, token) : null);
  await next();
});

publicRoutes.get('/seasons', async (c) => {
  const seasons = await c.env.DB.prepare('SELECT * FROM seasons ORDER BY created_at DESC').all();
  const sessions = await c.env.DB.prepare('SELECT * FROM sessions ORDER BY created_at DESC').all();
  return c.json({ seasons: seasons.results, sessions: sessions.results });
});

publicRoutes.get('/sessions/:id', async (c) => {
  const sessionId = Number(c.req.param('id'));
  if (!sessionId) return c.json({ error: 'not found' }, 404);
  // Served from the session DO's revision-keyed cache: one D1 rebuild per change, not one per browser.
  const res = await sessionStub(c.env, sessionId).fetch(`https://do/detail?sessionId=${sessionId}`);
  if (!res.ok) return c.json({ error: 'not found' }, 404);
  const detail = (await res.json()) as SessionDetail;
  // ALWAYS sanitized — even for admins. The raider-facing page must never show privileged
  // info (tiers, others' charges); the admin page uses GET /api/admin/sessions/:id/detail.
  return c.json(sanitizeDetail(detail, c.get('authedRaiderId')));
});

// ---- pre-planned rolls ----
publicRoutes.get('/sessions/:id/plans', async (c) => {
  const sessionId = Number(c.req.param('id'));
  // Only your own pre-picks, ever — identity comes from the token, not a query param.
  const raiderId = c.get('authedRaiderId');
  if (!raiderId) return c.json({ error: 'not logged in' }, 401);
  const rows = await c.env.DB.prepare('SELECT item_id, tier FROM plans WHERE session_id = ? AND raider_id = ?')
    .bind(sessionId, raiderId)
    .all<{ item_id: number; tier: Tier }>();
  const out: Record<number, Tier> = {};
  for (const r of rows.results) out[r.item_id] = r.tier;
  return c.json(out);
});

publicRoutes.put('/sessions/:id/plans', async (c) => {
  const sessionId = Number(c.req.param('id'));
  const body = await c.req.json<{ token?: string; itemId?: number; tier?: Tier | null }>();
  const itemId = Number(body.itemId);
  // Identity from the token (header via middleware, or body for older bundles) — never a bare raiderId.
  const raiderId = c.get('authedRaiderId') ?? (body.token ? await raiderForToken(c.env, body.token) : null);
  if (!raiderId) return c.json({ error: 'not logged in' }, 401);
  if (!itemId) return c.json({ error: 'itemId required' }, 400);
  const tier = body.tier ?? null;
  if (tier && !(tier in TIER_RANK)) return c.json({ error: 'bad tier' }, 400);

  const db = c.env.DB;
  const item = await db
    .prepare('SELECT i.resolved_at FROM items i JOIN bosses b ON b.id = i.boss_id WHERE i.id = ? AND b.session_id = ?')
    .bind(itemId, sessionId)
    .first<{ resolved_at: number | null }>();
  if (!item) return c.json({ error: 'item not found' }, 404);
  if (item.resolved_at != null) return c.json({ error: 'item already rolled' }, 409);

  const me = await getSessionRaider(db, sessionId, raiderId);
  if (!me) return c.json({ error: 'not in this session' }, 403);
  if (tier && tier !== 'pass' && (await hasRaiderWonCopy(db, itemId, raiderId)))
    return c.json({ error: 'You already won this item this session — duplicate copies are auto-passed' }, 409);
  if (tier === 'need' && me.need_remaining <= 0) return c.json({ error: 'No Need charges left this session' }, 409);
  if (tier === 'dibs' && !canDibs(me))
    return c.json({ error: me.dibs_remaining <= 0 ? 'No Dibs charges left this season' : 'Dibs requires an available Need charge' }, 409);

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
  // Let the admin's pre-pick preview refresh live — and nobody else's page (pre-picks are private).
  await notifyPlansChanged(c.env, sessionId);
  return c.json({ ok: true });
});

// ---- login: pick a roster name; presence tracks who is logged in ----
publicRoutes.get('/raiders', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT id, username, avatar, (password_hash IS NOT NULL) AS has_password FROM raiders ORDER BY username COLLATE NOCASE',
  ).all();
  return c.json(rows.results);
});

/** The logged-in raider's own roster record — one row, for pages that only need the viewer's avatar. */
publicRoutes.get('/raiders/me', async (c) => {
  const raiderId = c.get('authedRaiderId');
  if (!raiderId) return c.json({ error: 'not logged in' }, 401);
  const row = await c.env.DB.prepare('SELECT id, username, avatar FROM raiders WHERE id = ?')
    .bind(raiderId)
    .first<{ id: number; username: string; avatar: string | null }>();
  if (!row) return c.json({ error: 'raider not found' }, 404);
  return c.json(row);
});

/** Set (or clear, with null) the logged-in raider's avatar: a tiny client-resized data URL. */
const AVATAR_RE = /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/]+=*$/;
const MAX_AVATAR_CHARS = 65536;
publicRoutes.put('/raiders/me/avatar', async (c) => {
  const raiderId = c.get('authedRaiderId');
  if (!raiderId) return c.json({ error: 'not logged in' }, 401);
  const { avatar } = await c.req.json<{ avatar?: string | null }>();
  if (avatar != null && (typeof avatar !== 'string' || avatar.length > MAX_AVATAR_CHARS || !AVATAR_RE.test(avatar))) {
    return c.json({ error: 'bad avatar' }, 400);
  }
  await c.env.DB.prepare('UPDATE raiders SET avatar = ? WHERE id = ?').bind(avatar ?? null, raiderId).run();
  return c.json({ ok: true });
});

publicRoutes.get('/presence', async (c) => {
  const res = await presenceStub(c.env).fetch('https://do/online');
  return c.json(await res.json());
});

publicRoutes.post('/login', async (c) => {
  const { raiderId, token, password } = await c.req.json<{ raiderId?: number; token?: string; password?: string }>();
  const db = c.env.DB;
  const raider = await db
    .prepare('SELECT id, username, password_hash FROM raiders WHERE id = ?')
    .bind(Number(raiderId))
    .first<{ id: number; username: string; password_hash: string | null }>();
  if (!raider) return c.json({ error: 'raider not found' }, 404);

  // A presented token that still resolves to this raider skips the password
  // (the client's silent re-login / "heal" path) and hands the same token back.
  const healing = !!token && (await checkLogin(c.env, raider.id, token));
  if (!healing) {
    let hash = raider.password_hash;
    if (hash == null) {
      // First login: the raider sets their password now.
      if (!password || password.length < 4) return c.json({ error: 'Choose a password (at least 4 characters)' }, 400);
      const set = await db
        .prepare('UPDATE raiders SET password_hash = ? WHERE id = ? AND password_hash IS NULL')
        .bind(await hashPassword(password), raider.id)
        .run();
      if (!set.meta.changes) {
        // Someone else set it between our SELECT and UPDATE: verify against the winner's hash.
        hash = (await db.prepare('SELECT password_hash FROM raiders WHERE id = ?').bind(raider.id).first<{ password_hash: string | null }>())
          ?.password_hash ?? null;
      }
    }
    if (hash != null) {
      if (!password) return c.json({ error: 'Password required' }, 401);
      if (!(await verifyPassword(password, hash))) return c.json({ error: 'Wrong password' }, 401);
    }
  }

  // Durable multi-device logins: each successful password login mints its own token,
  // valid until logout or an admin ends it. No "already logged in" conflicts.
  const issued = healing ? token! : await createLogin(c.env, raider.id);
  return c.json({ raiderId: raider.id, username: raider.username, token: issued });
});

publicRoutes.get('/login/check', async (c) => {
  const ok = await checkLogin(c.env, Number(c.req.query('raiderId')), c.req.query('token') ?? '');
  return c.json({ ok });
});

publicRoutes.post('/logout', async (c) => {
  const { raiderId, token } = await c.req.json<{ raiderId?: number; token?: string }>();
  const t = c.req.header('x-loot-token') || token || '';
  await deleteLogin(c.env, t);
  // Close this device's presence socket so online badges update promptly.
  await presenceStub(c.env).fetch(`https://do/logout?raiderId=${Number(raiderId)}&token=${encodeURIComponent(t)}`, { method: 'POST' });
  return c.json({ ok: true });
});

publicRoutes.get('/presence/ws', async (c) => {
  if (c.req.header('Upgrade') !== 'websocket') return c.text('expected websocket', 426);
  const target = new URL('https://do/ws');
  // The route validates the token against D1; the DO just trusts the resolved raider id.
  const raiderId = c.get('authedRaiderId');
  if (raiderId) target.searchParams.set('raiderId', String(raiderId));
  const token = c.req.query('token');
  if (token) target.searchParams.set('token', token);
  const headers = new Headers(c.req.raw.headers);
  headers.set('X-Admin', (await isAdmin(c)) ? '1' : '0');
  return presenceStub(c.env).fetch(new Request(target, { headers }));
});

/** A raider's per-season record: remaining Dibs charges and their most recent item level in that season. */
publicRoutes.get('/raiders/:id/seasons', async (c) => {
  const raiderId = Number(c.req.param('id'));
  if (c.get('authedRaiderId') !== raiderId && !(await isAdmin(c))) return c.json({ error: 'not logged in' }, 401);
  const rows = await c.env.DB.prepare(
    `SELECT sr.season_id, sr.dibs_remaining, ${LAST_ILVL_SQL.replace('ssr.raider_id = ?', 'ssr.raider_id = sr.raider_id').replace('s.season_id = ?', 's.season_id = sr.season_id')} AS last_item_level
     FROM season_raiders sr WHERE sr.raider_id = ?`,
  )
    .bind(raiderId)
    .all<{ season_id: number; dibs_remaining: number; last_item_level: number }>();
  return c.json(rows.results.map((r) => ({ seasonId: r.season_id, dibsRemaining: r.dibs_remaining, lastItemLevel: r.last_item_level })));
});

/** Everything a raider has ever won, across all seasons, newest first. Their own tiers are theirs to see. */
publicRoutes.get('/raiders/:id/wins', async (c) => {
  const raiderId = Number(c.req.param('id'));
  if (c.get('authedRaiderId') !== raiderId) return c.json({ error: 'not logged in' }, 401);
  const rows = await c.env.DB.prepare(
    `SELECT i.id AS item_id, i.name, i.icon, i.win_tier, i.resolved_at,
            b.name AS boss_name, b.icon AS boss_icon,
            s.id AS session_id, s.name AS session_name,
            se.id AS season_id
     FROM items i
     JOIN bosses b ON b.id = i.boss_id
     JOIN sessions s ON s.id = b.session_id
     JOIN seasons se ON se.id = s.season_id
     WHERE i.winner_raider_id = ?1 AND i.resolved_at IS NOT NULL
     ORDER BY i.resolved_at DESC, i.id DESC`,
  )
    .bind(raiderId)
    .all<{
      item_id: number;
      name: string;
      icon: string | null;
      win_tier: Tier | null;
      resolved_at: number;
      boss_name: string;
      boss_icon: string | null;
      session_id: number;
      session_name: string;
      season_id: number;
    }>();
  return c.json({
    wins: rows.results.map((r) => ({
      itemId: r.item_id,
      name: r.name,
      icon: r.icon,
      winTier: r.win_tier,
      resolvedAt: r.resolved_at,
      bossName: r.boss_name,
      bossIcon: r.boss_icon,
      sessionId: r.session_id,
      sessionName: r.session_name,
      seasonId: r.season_id,
    })),
  });
});

publicRoutes.post('/sessions/:id/join', async (c) => {
  const sessionId = Number(c.req.param('id'));
  const body = await c.req.json<{ token?: string; itemLevel?: number }>();
  const itemLevel = Math.max(0, Math.floor(Number(body.itemLevel ?? 0)));
  const raiderId = c.get('authedRaiderId') ?? (body.token ? await raiderForToken(c.env, body.token) : null);
  if (!raiderId) return c.json({ error: 'not logged in' }, 401);

  const session = await c.env.DB.prepare('SELECT * FROM sessions WHERE id = ?')
    .bind(sessionId)
    .first<{ id: number; season_id: number; status: string }>();
  if (!session) return c.json({ error: 'not found' }, 404);
  if (session.status !== 'open') return c.json({ error: 'session is not accepting raiders right now' }, 409);

  const db = c.env.DB;
  const raider = await db.prepare('SELECT id, username FROM raiders WHERE id = ?').bind(raiderId).first<{ id: number; username: string }>();
  if (!raider) return c.json({ error: 'unknown raider - set your name first' }, 404);

  await joinSession(db, sessionId, session.season_id, raider.id, itemLevel);
  await notifySession(c.env, sessionId);
  return c.json({ raiderId: raider.id, username: raider.username });
});

/** REST fallback for the "happy with my picks" toggle, for raiders whose session socket is down. */
publicRoutes.post('/sessions/:id/lock-in', async (c) => {
  const sessionId = Number(c.req.param('id'));
  const body = await c.req.json<{ token?: string; value?: boolean }>();
  const raiderId = c.get('authedRaiderId') ?? (body.token ? await raiderForToken(c.env, body.token) : null);
  if (!raiderId) return c.json({ error: 'not logged in' }, 401);
  await sessionStub(c.env, sessionId).fetch(
    `https://do/lock-in?sessionId=${sessionId}&raiderId=${raiderId}&value=${body.value ? '1' : '0'}`,
    { method: 'POST' },
  );
  return c.json({ ok: true });
});

publicRoutes.get('/sessions/:id/ws', async (c) => {
  if (c.req.header('Upgrade') !== 'websocket') return c.text('expected websocket', 426);
  const sessionId = Number(c.req.param('id'));
  const target = new URL('https://do/ws');
  target.searchParams.set('sessionId', String(sessionId));
  // Only a logged-in raider gets a raider socket; otherwise they connect as a viewer.
  // Identity comes from the token alone (browsers can't set headers on WS upgrades).
  const raiderId = c.get('authedRaiderId');
  if (raiderId) target.searchParams.set('raiderId', String(raiderId));

  const headers = new Headers(c.req.raw.headers);
  // The admin page asks for the admin view explicitly (?admin=1); the raider page never does,
  // so even a logged-in admin sees only the sanitized raider view there.
  headers.set('X-Admin', c.req.query('admin') === '1' && (await isAdmin(c)) ? '1' : '0');
  return sessionStub(c.env, sessionId).fetch(new Request(target, { headers }));
});
