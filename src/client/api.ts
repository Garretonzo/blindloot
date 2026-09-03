import { RollEntry, Season, Session, SessionDetail, Tier } from '../shared/types';

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body) headers['content-type'] = 'application/json';
  // The server derives who we are from this token — no endpoint trusts a client-sent raiderId.
  const id = loadIdentity();
  if (id) headers['x-loot-token'] = id.token;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (data as { error?: string }).error ?? `HTTP ${res.status}`;
    // A raider action rejected as "not logged in" means our stored login is stale (expired,
    // ended by an admin, or the server's presence state was reset). Drop it. A 401 from
    // /api/login itself is a failed login attempt (wrong/missing password), not a lost login.
    if (res.status === 401 && url !== '/api/login' && !url.startsWith('/api/admin') && !url.startsWith('/api/site')) {
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
  session: (id: number) => req<SessionDetail>('GET', `/api/sessions/${id}`),
  plans: (id: number) => req<Record<number, Tier>>('GET', `/api/sessions/${id}/plans`),
  setPlan: (id: number, me: Identity, itemId: number, tier: Tier | null) =>
    req('PUT', `/api/sessions/${id}/plans`, { token: me.token, itemId, tier }),
  /** REST fallback for the "happy with my picks" toggle when the session socket is down. */
  lockIn: (id: number, value: boolean) => req('POST', `/api/sessions/${id}/lock-in`, { value }),
  roster: () => req<{ id: number; username: string; avatar: string | null; has_password: number }[]>('GET', '/api/raiders'),
  /** The logged-in raider's own roster record (one row — pages that only need their own avatar use this, not the roster). */
  me: () => req<{ id: number; username: string; avatar: string | null }>('GET', '/api/raiders/me'),
  /** Set (or clear, with null) the logged-in raider's avatar — a tiny data URL from fileToAvatar. */
  setAvatar: (avatar: string | null) => req('PUT', '/api/raiders/me/avatar', { avatar }),
  presence: () => req<{ online: number[] }>('GET', '/api/presence'),
  /**
   * Log in as a roster raider. Passing the current token makes it an idempotent refresh of an
   * existing login (no password needed while it's active). Otherwise the raider's password is
   * required — and sets it on their very first login.
   */
  login: (raiderId: number, token?: string, password?: string) => req<Identity>('POST', '/api/login', { raiderId, token, password }),
  /** Is this stored login still valid on the server? */
  checkLogin: (id: Identity) => req<{ ok: boolean }>('GET', `/api/login/check?raiderId=${id.raiderId}&token=${encodeURIComponent(id.token)}`),
  logout: (id: Identity) => req('POST', '/api/logout', { raiderId: id.raiderId, token: id.token }),
  mySeasons: (raiderId: number) =>
    req<{ seasonId: number; dibsRemaining: number; lastItemLevel: number }[]>('GET', `/api/raiders/${raiderId}/seasons`),
  /** Everything the logged-in raider has ever won, across all seasons, newest first. */
  myWins: (me: Identity) => req<{ wins: MyWin[] }>('GET', `/api/raiders/${me.raiderId}/wins`),
  join: (id: number, me: Identity, itemLevel: number) =>
    req<{ raiderId: number; username: string }>('POST', `/api/sessions/${id}/join`, { token: me.token, itemLevel }),

  admin: {
    me: () => req<{ admin: boolean; super: boolean }>('GET', '/api/admin/me'),
    login: (password: string) => req<{ ok: true; role: 'admin' | 'super' }>('POST', '/api/admin/login', { password }),
    logout: () => req<{ ok: true }>('POST', '/api/admin/logout'),
    createSeason: (name: string, raidId: string, dibsPerSeason?: number, needPerSession?: number) =>
      req<Season>('POST', '/api/admin/seasons', { name, raidId, dibsPerSeason, needPerSession }),
    renameSeason: (seasonId: number, name: string) => req('PATCH', `/api/admin/seasons/${seasonId}`, { name }),
    updateSeasonLimits: (seasonId: number, limits: { dibsPerSeason?: number; needPerSession?: number }) =>
      req('PATCH', `/api/admin/seasons/${seasonId}`, limits),
    renameSession: (sessionId: number, name: string) => req('PATCH', `/api/admin/sessions/${sessionId}`, { name }),
    /** Unsanitized session detail — the public api.session() is always raider-sanitized, even for admins. */
    session: (sessionId: number) => req<SessionDetail>('GET', `/api/admin/sessions/${sessionId}/detail`),
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
      body: { username?: string; itemLevel?: number; dibsRemaining?: number; needRemaining?: number },
    ) => req('PATCH', `/api/admin/sessions/${sessionId}/raiders/${raiderId}`, body),
    raiders: () => req<RosterRaider[]>('GET', '/api/admin/raiders'),
    createRaider: (username: string) => req<{ id: number; username: string; created: boolean }>('POST', '/api/admin/raiders', { username }),
    renameRaider: (id: number, username: string) => req('PATCH', `/api/admin/raiders/${id}`, { username }),
    deleteRaider: (id: number) => req('DELETE', `/api/admin/raiders/${id}`),
    endLogin: (raiderId: number) => req('DELETE', `/api/admin/logins/${raiderId}`),
    resetPassword: (raiderId: number) => req('DELETE', `/api/admin/raiders/${raiderId}/password`),
    addRaider: (sessionId: number, raiderId: number, itemLevel: number) =>
      req<Identity>('POST', `/api/admin/sessions/${sessionId}/raiders`, { raiderId, itemLevel }),
    removeRaider: (sessionId: number, raiderId: number) =>
      req('DELETE', `/api/admin/sessions/${sessionId}/raiders/${raiderId}`),
    history: (seasonId: number) => req<HistoryData>('GET', `/api/admin/seasons/${seasonId}/history`),
    /** Raiders who have raided this season, with their remaining season-level Dibs. */
    seasonRaiders: (seasonId: number) =>
      req<{ id: number; username: string; dibs_remaining: number }[]>('GET', `/api/admin/seasons/${seasonId}/raiders`),
    updateSeasonRaider: (seasonId: number, raiderId: number, dibsRemaining: number) =>
      req('PATCH', `/api/admin/seasons/${seasonId}/raiders/${raiderId}`, { dibsRemaining }),
    backups: {
      list: () => req<BackupMeta[]>('GET', '/api/admin/backups'),
      create: (name: string) => req<BackupMeta>('POST', '/api/admin/backups', { name }),
      restore: (id: number) => req<{ ok: true; preBackupId: number }>('POST', `/api/admin/backups/${id}/restore`),
      delete: (id: number) => req('DELETE', `/api/admin/backups/${id}`),
      /** Upload a previously exported backup file's JSON text and replace everything with it. */
      import: (json: unknown) => req<{ ok: true; preBackupId: number }>('POST', '/api/admin/import', json),
    },
  },
};

/** One item the raider won, with enough context to show it outside its session. */
export interface MyWin {
  itemId: number;
  name: string;
  icon: string | null;
  winTier: Tier | null;
  resolvedAt: number;
  bossName: string;
  bossIcon: string | null;
  sessionId: number;
  sessionName: string;
  seasonId: number;
}

export interface BackupMeta {
  id: number;
  name: string;
  kind: 'manual' | 'pre-restore' | 'pre-import';
  created_at: number;
  bytes: number;
}

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
  /** Tiny data-URL avatar, null = none. */
  avatar: string | null;
  created_at: number;
  /** 0 = passwordless: their next login prompts them to set one. */
  has_password: number;
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
  raiders: { id: number; username: string; item_level: number; dibs_remaining: number }[];
}

export interface Identity {
  raiderId: number;
  username: string;
  /** Durable login token (one per device); sent on every request to prove who we are. */
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
