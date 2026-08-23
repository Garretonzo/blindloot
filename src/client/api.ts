import { RollEntry, Season, Session, SessionDetail, Tier } from '../shared/types';

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (data as { error?: string }).error ?? `HTTP ${res.status}`;
    // A raider action rejected as "not logged in" means our stored login is stale (expired,
    // ended by an admin, or the server's presence state was reset). Drop it.
    if (res.status === 401 && !url.startsWith('/api/admin') && !url.startsWith('/api/site')) {
      window.dispatchEvent(new CustomEvent(LOGIN_LOST_EVENT, { detail: message }));
    }
    throw new Error(message);
  }
  return data as T;
}

/** Fired when the server says our raider login is no longer valid. */
export const LOGIN_LOST_EVENT = 'loot:login-lost';

export const api = {
  site: {
    me: () => req<{ ok: boolean; gated: boolean }>('GET', '/api/site/me'),
    login: (password: string) => req<{ ok: true }>('POST', '/api/site/login', { password }),
  },
  seasons: () => req<{ seasons: Season[]; sessions: Session[] }>('GET', '/api/seasons'),
  session: (id: number, raiderId?: number | null) =>
    req<SessionDetail>('GET', `/api/sessions/${id}${raiderId ? `?raiderId=${raiderId}` : ''}`),
  plans: (id: number, raiderId: number) => req<Record<number, Tier>>('GET', `/api/sessions/${id}/plans?raiderId=${raiderId}`),
  setPlan: (id: number, me: Identity, itemId: number, tier: Tier | null) =>
    req('PUT', `/api/sessions/${id}/plans`, { raiderId: me.raiderId, token: me.token, itemId, tier }),
  roster: () => req<{ id: number; username: string }[]>('GET', '/api/raiders'),
  presence: () => req<{ online: number[] }>('GET', '/api/presence'),
  login: (raiderId: number) => req<Identity>('POST', '/api/login', { raiderId }),
  /** Is this stored login still valid on the server? */
  checkLogin: (id: Identity) => req<{ ok: boolean }>('GET', `/api/login/check?raiderId=${id.raiderId}&token=${encodeURIComponent(id.token)}`),
  logout: (id: Identity) => req('POST', '/api/logout', { raiderId: id.raiderId, token: id.token }),
  mySeasons: (raiderId: number) =>
    req<{ seasonId: number; hasDibs: boolean; lastItemLevel: number }[]>('GET', `/api/raiders/${raiderId}/seasons`),
  join: (id: number, me: Identity, itemLevel: number) =>
    req<{ raiderId: number; username: string }>('POST', `/api/sessions/${id}/join`, { raiderId: me.raiderId, token: me.token, itemLevel }),

  admin: {
    me: () => req<{ admin: boolean; super: boolean }>('GET', '/api/admin/me'),
    login: (password: string) => req<{ ok: true; role: 'admin' | 'super' }>('POST', '/api/admin/login', { password }),
    logout: () => req<{ ok: true }>('POST', '/api/admin/logout'),
    createSeason: (name: string, raidId: string) => req<Season>('POST', '/api/admin/seasons', { name, raidId }),
    renameSeason: (seasonId: number, name: string) => req('PATCH', `/api/admin/seasons/${seasonId}`, { name }),
    renameSession: (sessionId: number, name: string) => req('PATCH', `/api/admin/sessions/${sessionId}`, { name }),
    deleteSeason: (seasonId: number) => req('DELETE', `/api/admin/seasons/${seasonId}`),
    createSession: (seasonId: number, name: string) =>
      req<Session>('POST', '/api/admin/sessions', { seasonId, name }),
    deleteSession: (sessionId: number) => req('DELETE', `/api/admin/sessions/${sessionId}`),
    addBoss: (sessionId: number, name: string, icon: string | null, items: { name: string; icon: string | null }[]) =>
      req('POST', `/api/admin/sessions/${sessionId}/bosses`, { name, icon, items }),
    addItem: (sessionId: number, bossId: number, name: string, icon: string | null = null) =>
      req('POST', `/api/admin/sessions/${sessionId}/bosses/${bossId}/items`, { name, icon }),
    deleteItem: (sessionId: number, itemId: number) =>
      req('DELETE', `/api/admin/sessions/${sessionId}/items/${itemId}`),
    rolls: (sessionId: number) => req<Record<number, RollEntry[]>>('GET', `/api/admin/sessions/${sessionId}/rolls`),
    plans: (sessionId: number) => req<Record<number, PlanPreview[]>>('GET', `/api/admin/sessions/${sessionId}/plans`),
    plansSummary: (sessionId: number) =>
      req<{ raiders: { raiderId: number; picks: number }[]; unresolvedItems: number }>('GET', `/api/admin/sessions/${sessionId}/plans-summary`),
    award: (sessionId: number, itemId: number, raiderId: number | null, tier: Tier | null, force = false) =>
      req<{ ok: true; tier: Tier | null }>('POST', `/api/admin/sessions/${sessionId}/items/${itemId}/award`, { raiderId, tier, force }),
    deleteBoss: (sessionId: number, bossId: number) =>
      req('DELETE', `/api/admin/sessions/${sessionId}/bosses/${bossId}`),
    updateRaider: (
      sessionId: number,
      raiderId: number,
      body: { username?: string; itemLevel?: number; hasDibs?: boolean; needAvailable?: boolean },
    ) => req('PATCH', `/api/admin/sessions/${sessionId}/raiders/${raiderId}`, body),
    raiders: () => req<RosterRaider[]>('GET', '/api/admin/raiders'),
    createRaider: (username: string) => req<{ id: number; username: string; created: boolean }>('POST', '/api/admin/raiders', { username }),
    renameRaider: (id: number, username: string) => req('PATCH', `/api/admin/raiders/${id}`, { username }),
    deleteRaider: (id: number) => req('DELETE', `/api/admin/raiders/${id}`),
    endLogin: (raiderId: number) => req('DELETE', `/api/admin/logins/${raiderId}`),
    addRaider: (sessionId: number, raiderId: number, itemLevel: number) =>
      req<Identity>('POST', `/api/admin/sessions/${sessionId}/raiders`, { raiderId, itemLevel }),
    removeRaider: (sessionId: number, raiderId: number) =>
      req('DELETE', `/api/admin/sessions/${sessionId}/raiders/${raiderId}`),
    history: (seasonId: number) => req<HistoryData>('GET', `/api/admin/seasons/${seasonId}/history`),
  },
};

export interface PlanPreview {
  raiderId: number;
  username: string;
  tier: Tier;
  /** What the pick will count as today (demoted if the raider already spent Need/Dibs). */
  effectiveTier: Tier;
}

export interface RosterRaider {
  id: number;
  username: string;
  created_at: number;
}

export interface HistoryData {
  sessions: Session[];
  items: {
    session_id: number;
    boss_name: string;
    item_id: number;
    item_name: string;
    win_tier: string | null;
    winner: string | null;
  }[];
  rolls: { item_id: number; username: string; tier: string; roll_value: number | null; won: number }[];
  raiders: { id: number; username: string; item_level: number; has_dibs: number }[];
}

export interface Identity {
  raiderId: number;
  username: string;
  /** Login token from the presence service; required for raider actions. */
  token: string;
}

const ID_KEY = 'loot_identity';

export function loadIdentity(): Identity | null {
  try {
    const raw = localStorage.getItem(ID_KEY);
    const id = raw ? (JSON.parse(raw) as Identity) : null;
    return id && id.token ? id : null; // identities from before login tokens are discarded
  } catch {
    return null;
  }
}

export function saveIdentity(id: Identity | null) {
  try {
    if (id) localStorage.setItem(ID_KEY, JSON.stringify(id));
    else localStorage.removeItem(ID_KEY);
  } catch {
    /* ignore */
  }
}
