import { Env } from './env';

export function sessionStub(env: Env, sessionId: number) {
  return env.SESSION.get(env.SESSION.idFromName(`session-${sessionId}`));
}

export function presenceStub(env: Env) {
  return env.PRESENCE.get(env.PRESENCE.idFromName('global'));
}

export async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** How stale last_seen may get before a token lookup refreshes it (keeps reads from becoming writes). */
const LAST_SEEN_SLACK_MS = 60 * 60 * 1000;

/** Resolve a presented login token to its raider id, or null. Only the hash ever touches D1. */
export async function raiderForToken(env: Env, token: string): Promise<number | null> {
  if (!token) return null;
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare('SELECT raider_id, last_seen FROM logins WHERE token_hash = ?')
    .bind(hash)
    .first<{ raider_id: number; last_seen: number }>();
  if (!row) return null;
  const now = Date.now();
  if (now - row.last_seen > LAST_SEEN_SLACK_MS) {
    await env.DB.prepare('UPDATE logins SET last_seen = ? WHERE token_hash = ?').bind(now, hash).run();
  }
  return row.raider_id;
}

/** Is this raider currently logged in with this token? */
export async function checkLogin(env: Env, raiderId: number, token: string): Promise<boolean> {
  if (!raiderId || !token) return false;
  return (await raiderForToken(env, token)) === raiderId;
}

/** Mint a durable login token for a raider and record its hash in D1. */
export async function createLogin(env: Env, raiderId: number): Promise<string> {
  const token = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare('INSERT INTO logins (token_hash, raider_id, created_at, last_seen) VALUES (?, ?, ?, ?)')
    .bind(await sha256Hex(token), raiderId, now, now)
    .run();
  // Opportunistic cleanup: drop logins idle for 90+ days.
  await env.DB.prepare('DELETE FROM logins WHERE last_seen < ?').bind(now - 90 * 24 * 60 * 60 * 1000).run();
  return token;
}

/** Delete one login by its (unhashed) token. */
export async function deleteLogin(env: Env, token: string) {
  if (!token) return;
  await env.DB.prepare('DELETE FROM logins WHERE token_hash = ?').bind(await sha256Hex(token)).run();
}

/** Delete every login a raider holds (admin end, raider delete, password reset). */
export async function deleteRaiderLogins(env: Env, raiderId: number) {
  await env.DB.prepare('DELETE FROM logins WHERE raider_id = ?').bind(raiderId).run();
}

export async function clearSession(env: Env, sessionId: number) {
  await sessionStub(env, sessionId).fetch(`https://do/clear?sessionId=${sessionId}`);
}

/** After a restore/import: drop any stale live roll-off state, keeping clients connected. */
export async function resetSessionLive(env: Env, sessionId: number, phase: 'open' | 'closed') {
  await sessionStub(env, sessionId).fetch(`https://do/reset-live?sessionId=${sessionId}&phase=${phase}`);
}

/** Tell the session's live clients to refetch. `lootChanged` also clears raiders' "happy with my picks" flags. */
export async function notifySession(env: Env, sessionId: number, lootChanged = false) {
  await sessionStub(env, sessionId).fetch(`https://do/notify?sessionId=${sessionId}${lootChanged ? '&loot=1' : ''}`);
}
