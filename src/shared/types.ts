export type Tier = 'greed' | 'equip' | 'need' | 'dibs';
export const TIER_RANK: Record<Tier, number> = { greed: 0, equip: 1, need: 2, dibs: 3 };
export const TIER_LABEL: Record<Tier, string> = {
  greed: 'Transmog',
  equip: 'Equip',
  need: 'Need',
  dibs: 'Dibs',
};

/** One-line meaning of each tier, shown in tooltips and on the help page. */
export const TIER_HINT: Record<Tier, string> = {
  greed: "It's pretty or it sells. Unlimited.",
  equip: "You'd actually wear it. Unlimited. Beats Transmog.",
  need: 'You want it for real. One win per week (per difficulty). Beats Equip.',
  dibs: 'More than anything. One win per season. Beats Need; ties go to item level.',
};

/** Mantine color per tier, used everywhere a tier is displayed. */
export const TIER_COLOR: Record<Tier, string> = {
  greed: 'gray',
  equip: 'blue',
  need: 'orange',
  dibs: 'grape',
};

export type SessionStatus = 'open' | 'staging' | 'rolling' | 'closed';

export interface Season {
  id: number;
  name: string;
  /** Which bundled boss/loot pool this season uses (RaidData.id). */
  raid_id: string;
  created_at: number;
}

export interface Session {
  id: number;
  season_id: number;
  name: string;
  status: SessionStatus;
  created_at: number;
}

export interface Raider {
  id: number;
  username: string;
  item_level: number;
  /** Season-level Dibs still unspent. */
  has_dibs: boolean;
  /** Session-level Need still available (also cleared by winning with Dibs). */
  need_available: boolean;
  /** Dibs locked for this session because the raider won with Need. */
  dibs_locked: boolean;
}

/** Can this raider use Dibs on an item in this session right now? */
export const canDibs = (r: Pick<Raider, 'has_dibs' | 'dibs_locked'>) => r.has_dibs && !r.dibs_locked;

/** Drop a tier to what the raider can still afford: Dibs → Need if no Dibs, Need → Equip if no Need. */
export function demoteTier(tier: Tier, e: { needAvailable: boolean; canDibs: boolean }): Tier {
  let t = tier;
  if (t === 'dibs' && !e.canDibs) t = 'need';
  if (t === 'need' && !e.needAvailable) t = 'equip';
  return t;
}

export interface Item {
  id: number;
  boss_id: number;
  name: string;
  icon: string | null;
  sort_order: number;
  winner_raider_id: number | null;
  win_tier: Tier | null;
  resolved_at: number | null;
}

export interface Boss {
  id: number;
  name: string;
  icon: string | null;
  sort_order: number;
  items: Item[];
}

/** Bundled static raid data (see scripts/fetch-loot-data.mjs). */
export interface RaidData {
  id: string;
  name: string;
  season: string;
  bosses: { slug: string; name: string; icon: string | null; items: RaidItem[] }[];
}
export interface RaidItem {
  id: number;
  name: string;
  icon: string | null;
  slot: string | null;
  type: string | null;
}

export interface SessionDetail {
  session: Session;
  season: Season;
  bosses: Boss[];
  raiders: Raider[];
}

export interface RollEntry {
  raiderId: number;
  username: string;
  /** Absent in the sanitized copy sent to non-admin raiders. */
  tier?: Tier;
  roll: number | null;
  itemLevel: number;
  won: boolean;
  /** Admin rolls view: what this tier would count as today, given what the raider has won since. */
  effectiveTier?: Tier;
  /** Admin rolls view: true when effectiveTier is lower than the rolled tier. */
  ineligible?: boolean;
}

export interface ItemResult {
  itemId: number;
  itemName: string;
  bossName: string;
  winnerId: number | null;
  winnerName: string | null;
  winTier: Tier | null;
  entries: RollEntry[];
}

export type Phase = 'open' | 'ready' | 'item' | 'results' | 'closed';

/** Live state broadcast by the session Durable Object. */
export interface LiveState {
  phase: Phase;
  readyRaiderIds: number[];
  itemIds: number[];
  currentIndex: number;
  /** Absolute ms timestamp the current countdown ends; null while paused. */
  deadline: number | null;
  paused: boolean;
  /** Remaining countdown ms captured at pause time. */
  pausedRemainingMs: number | null;
  /** When false, each new item starts paused until the admin resumes. */
  autoContinue: boolean;
  /** Admin-configurable countdown lengths. */
  itemSeconds: number;
  resultSeconds: number;
  /** raiderId -> chosen tier for the current item (non-admins only receive their own entry) */
  choices: Record<number, Tier>;
  /** Number of raiders who have chosen on the current item. */
  choiceCount: number;
  lastResult: ItemResult | null;
  /** Randomize item order for the next live roll-off or batch. */
  shuffle: boolean;
  /** Results of the last instant batch (replaced by the next one; cleared when a live roll-off starts). */
  batchResults: ItemResult[] | null;
  /** bump to tell clients to refetch session detail */
  revision: number;
}

export type ClientMessage =
  | { type: 'ready' }
  | { type: 'choose'; tier: Tier | null }
  | { type: 'stage' }
  | { type: 'start' }
  | { type: 'next' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'setAutoContinue'; value: boolean }
  | { type: 'setTimers'; itemSeconds?: number; resultSeconds?: number }
  | { type: 'setShuffle'; value: boolean }
  | { type: 'runBatch' }
  | { type: 'close' }
  | { type: 'reopen' }
  | { type: 'reset' };

export type ServerMessage = { type: 'state'; state: LiveState } | { type: 'error'; message: string };
