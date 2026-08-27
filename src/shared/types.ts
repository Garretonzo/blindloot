/** Roll types. `pass` is an explicit "not rolling" — it never wins and costs nothing. */
export type Tier = 'pass' | 'greed' | 'offspec' | 'equip' | 'need' | 'dibs';
export const TIER_RANK: Record<Tier, number> = { pass: -1, greed: 0, offspec: 1, equip: 2, need: 3, dibs: 4 };
/** Every tier, lowest to highest. */
export const TIERS: Tier[] = ['pass', 'greed', 'offspec', 'equip', 'need', 'dibs'];
export const TIER_LABEL: Record<Tier, string> = {
  pass: 'Pass',
  greed: 'Transmog',
  offspec: 'Off-spec',
  equip: 'Equip',
  need: 'Need',
  dibs: 'Dibs',
};

/** One-line meaning of each tier, shown in tooltips and on the help page. */
export const TIER_HINT: Record<Tier, string> = {
  pass: "Not rolling. Don't want it.",
  greed: 'It looks cool. Unlimited rolls.',
  offspec: "You'd wear it for an off-spec. Unlimited rolls. Off-spec beats Transmog.",
  equip: "You'd actually wear it, main spec. If you lie and I catch you, you're out. Unlimited rolls. Equip beats Off-spec.",
  need: 'You want it for real. Limited wins per week (per difficulty). Set by the raid leader. Need beats Equip.',
  dibs: 'More than anything. Limited wins per season. Set by the raid leader. Each Dibs win also spends a Need charge. Dibs beats Need. Multiple Dibs: higher item level wins outright; only an exact ilvl tie is rolled.',
};

/** Mantine color per tier, used everywhere a tier is displayed. */
export const TIER_COLOR: Record<Tier, string> = {
  pass: 'red',
  greed: 'gray',
  offspec: 'cyan',
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
  /** Dibs charges each raider gets for the whole season. */
  dibs_per_season: number;
  /** Need wins each raider is allowed per session (a Dibs win also spends one). */
  need_per_session: number;
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
  /** Tiny data-URL avatar the raider uploaded (present in session detail and roster payloads); null = none. */
  avatar?: string | null;
  item_level: number;
  /** Season-level Dibs charges still unspent. Non-admin payloads OMIT this for everyone but the viewer — only read it on `me` or in admin views. */
  dibs_remaining: number;
  /** Session-level Need charges still unspent (a Dibs win also spends one). Omitted for others in non-admin payloads, like dibs_remaining. */
  need_remaining: number;
  /** The season's configured Dibs allowance (for "x of y" displays). */
  dibs_limit: number;
  /** The season's configured Need-wins-per-session allowance. */
  need_limit: number;
}

/** Can this raider use Dibs on an item in this session right now? A Dibs win also costs a Need charge, so one must be available. */
export const canDibs = (r: Pick<Raider, 'dibs_remaining' | 'need_remaining'>) => r.dibs_remaining > 0 && r.need_remaining > 0;

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
  /** Hidden (null) from raiders, except on items the viewer won themselves. */
  win_tier: Tier | null;
  resolved_at: number | null;
  /** Raider view only: the viewer's recorded pre-pick on an item they won (null = rolled live / no pre-pick). */
  my_picked_tier?: Tier | null;
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
  bosses: RaidBoss[];
}
export interface RaidBoss {
  slug: string;
  name: string;
  icon: string | null;
  /** Wowhead page for the boss. */
  url?: string;
  items: RaidItem[];
}
export interface RaidItem {
  id: number;
  name: string;
  icon: string | null;
  slot: string | null;
  type: string | null;
  /** WoW item quality id (0 poor … 5 legendary). */
  quality?: number;
  /** In-game tooltip, one line per entry. */
  tooltip?: string[];
  /** Wowhead page for the item. */
  url?: string;
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
  /** Summary: the raider's pre-pick at resolution time (null = none / rolled live). */
  pickedTier?: Tier | null;
}

/** One resolved item in the admin summary, in resolution order. */
export interface SummaryItem {
  itemId: number;
  name: string;
  icon: string | null;
  bossName: string;
  bossIcon: string | null;
  order: number;
  mode: 'batch' | 'live' | 'award' | null;
  winnerId: number | null;
  winnerName: string | null;
  winTier: Tier | null;
  entries: RollEntry[];
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
  /** Smart item order (priority + random ties) for roll-offs and batches; false = plain list order. */
  shuffle: boolean;
  /** Raiders who've said they're happy with their pre-picks (cleared when loot changes or a batch runs). */
  lockedIn: number[];
  /** bump to tell clients to refetch session detail */
  revision: number;
}

export type ClientMessage =
  | { type: 'ready' }
  | { type: 'choose'; tier: Tier | null }
  | { type: 'lockIn'; value: boolean }
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
