import { Tier, TIER_LABEL, TIER_RANK, RollEntry } from './types';

export interface Participant {
  id: number;
  username: string;
  itemLevel: number;
  tier: Tier;
}

export interface Resolution {
  winnerId: number | null;
  winTier: Tier | null;
  entries: RollEntry[];
}

/** Random integer in [1, 100]. */
export const d100 = () => Math.floor(Math.random() * 100) + 1;

/** raiderId -> tier -> items won at that tier, for the win-equalization filter. */
export type WinCounts = Record<number, Partial<Record<Tier, number>>>;

/**
 * Order pending items for rolling: items whose top effective pre-pick tier is highest go first
 * (the Dibs group, then Need, then Equip, …; items nobody plans on last). Within a group,
 * fewest planners at that top tier first, so near-uncontested picks resolve before their
 * planners' charges are spent elsewhere. Ties keep input order — pass `ids` pre-shuffled
 * for a random tie-break.
 */
export function orderItemsByPriority(ids: number[], effectivePlans: Map<number, Tier[]>): number[] {
  const key = (id: number) => {
    const tiers = (effectivePlans.get(id) ?? []).filter((t) => t !== 'pass');
    if (tiers.length === 0) return { rank: -1, count: 0 };
    const rank = Math.max(...tiers.map((t) => TIER_RANK[t]));
    return { rank, count: tiers.filter((t) => TIER_RANK[t] === rank).length };
  };
  const keys = new Map(ids.map((id) => [id, key(id)]));
  return [...ids].sort((a, b) => {
    const ka = keys.get(a)!;
    const kb = keys.get(b)!;
    return kb.rank - ka.rank || ka.count - kb.count;
  });
}

/**
 * Decide who wins an item.
 * Highest tier present wins. Within Dibs (dibs): highest item level, ties broken by roll.
 * Within other tiers: highest 1-100 roll wins.
 * Every participant rolls (when there is more than one) so runner-ups in every tier can be ranked.
 * When `winCounts` is given, the win-equalization filter applies: within the item's top contested
 * tier, only rollers tied for the fewest wins at that tier are eligible to take it. Lower tiers
 * never benefit — the filter picks among the top group only.
 */
export function resolveItem(participants: Participant[], rng: () => number = d100, winCounts?: WinCounts): Resolution {
  // Passers are recorded (so the admin sees them) but never roll and never win.
  const rollers = participants.filter((p) => p.tier !== 'pass');
  const passers = participants.filter((p) => p.tier === 'pass');

  const rolls = new Map<number, number>();
  if (rollers.length > 1) {
    for (const p of rollers) rolls.set(p.id, rng());
  }

  const toEntry = (p: Participant): RollEntry => ({
    raiderId: p.id,
    username: p.username,
    tier: p.tier,
    roll: rolls.get(p.id) ?? null,
    itemLevel: p.itemLevel,
    won: false,
  });
  const entries: RollEntry[] = [...rollers.map(toEntry), ...passers.map(toEntry)];
  if (rollers.length === 0) return { winnerId: null, winTier: null, entries };

  let eligible: ((e: RollEntry) => boolean) | undefined;
  if (winCounts) {
    const topTier = rollers.reduce((a, b) => (TIER_RANK[b.tier] > TIER_RANK[a.tier] ? b : a)).tier;
    const group = rollers.filter((p) => p.tier === topTier);
    const count = (id: number) => winCounts[id]?.[topTier] ?? 0;
    const min = Math.min(...group.map((p) => count(p.id)));
    const ok = new Set(group.filter((p) => count(p.id) === min).map((p) => p.id));
    eligible = (e) => e.tier !== topTier || ok.has(e.raiderId);
  }

  const winner = rankEntries(entries.filter((e) => e.tier !== 'pass'), eligible)[0];
  winner.won = true;
  return { winnerId: winner.raiderId, winTier: winner.tier!, entries };
}

/**
 * Order entries best-first: by tier, then eligibility (when given), then recorded win,
 * then (Dibs only) item level, then roll. The first element is the winner under the loot rules;
 * the `won` key keeps an equalized winner on top when re-ranking recorded rolls.
 */
export function rankEntries(entries: RollEntry[], eligible?: (e: RollEntry) => boolean): RollEntry[] {
  return [...entries].sort((a, b) => {
    const t = TIER_RANK[b.tier!] - TIER_RANK[a.tier!];
    if (t !== 0) return t;
    if (eligible) {
      const e = Number(eligible(b)) - Number(eligible(a));
      if (e !== 0) return e;
    }
    if (a.won !== b.won) return Number(b.won) - Number(a.won);
    if (a.tier === 'dibs' && b.itemLevel !== a.itemLevel) return b.itemLevel - a.itemLevel;
    return (b.roll ?? 0) - (a.roll ?? 0);
  });
}

/**
 * One-line, human explanation of how an item was decided, from its recorded entries.
 * e.g. "Dibs · ilvl 625 beat Bob's 618", "Need · rolled 91 vs Bob 77", "Uncontested Equip".
 */
export function explainResult(entries: RollEntry[]): string {
  const rollers = entries.filter((e) => e.tier && e.tier !== 'pass');
  if (rollers.length === 0) return 'Nobody rolled.';
  const ranked = rankEntries(rollers);
  const winner = ranked[0];
  const top = winner.tier!;
  const contenders = ranked.filter((e) => e.tier === top);
  const lower = rollers.length - contenders.length;
  const outranked = lower > 0 ? ` Outranked ${lower} lower pick${lower === 1 ? '' : 's'}.` : '';
  const label = TIER_LABEL[top];
  if (contenders.length === 1) return `Uncontested ${label}.${outranked}`;
  const others = contenders.slice(1);
  // A same-tier contender out-rolling (or out-ilvl-ing, for Dibs) the winner only happens via
  // win-equalization — call it out so the sentence doesn't read like a bug.
  const equalized =
    top === 'dibs'
      ? others.some((e) => e.itemLevel > winner.itemLevel || (e.itemLevel === winner.itemLevel && (e.roll ?? 0) > (winner.roll ?? 0)))
      : others.some((e) => (e.roll ?? 0) > (winner.roll ?? 0));
  const eq = equalized ? ' (win-equalized: fewest wins go first)' : '';
  if (top === 'dibs') {
    const sameIlvl = others.filter((e) => e.itemLevel === winner.itemLevel);
    if (sameIlvl.length === 0) {
      return `${label} · ilvl ${winner.itemLevel}${eq} beat ${others.map((e) => `${e.username}'s ${e.itemLevel}`).join(', ')}.${outranked}`;
    }
    return `${label} · ilvl tie (${winner.itemLevel}) — rolled ${winner.roll}${eq} vs ${sameIlvl.map((e) => `${e.username} ${e.roll}`).join(', ')}.${outranked}`;
  }
  return `${label} · rolled ${winner.roll}${eq} vs ${others.map((e) => `${e.username} ${e.roll}`).join(', ')}.${outranked}`;
}

/** Top N entries per tier, each list best-first. */
export function rankByTier(entries: RollEntry[], n = 3): Record<Tier, RollEntry[]> {
  const out: Record<Tier, RollEntry[]> = { dibs: [], need: [], equip: [], offspec: [], greed: [], pass: [] };
  for (const e of rankEntries(entries)) {
    const list = out[e.tier!];
    if (list.length < n) list.push(e);
  }
  return out;
}
