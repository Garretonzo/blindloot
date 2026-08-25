import { Env } from './env';

export function sessionStub(env: Env, sessionId: number) {
  return env.SESSION.get(env.SESSION.idFromName(`session-${sessionId}`));
}

export function presenceStub(env: Env) {
  return env.PRESENCE.get(env.PRESENCE.idFromName('global'));
}

/** Is this raider currently logged in with this token? */
export async function checkLogin(env: Env, raiderId: number, token: string): Promise<boolean> {
  if (!raiderId || !token) return false;
  const res = await presenceStub(env).fetch(`https://do/check?raiderId=${raiderId}&token=${encodeURIComponent(token)}`);
  return ((await res.json()) as { ok: boolean }).ok;
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
