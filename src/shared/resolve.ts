import { Tier, TIER_RANK, RollEntry } from './types';

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

/**
 * Decide who wins an item.
 * Highest tier present wins. Within Dibs (dibs): highest item level, ties broken by roll.
 * Within other tiers: highest 1-100 roll wins.
 * Every participant rolls (when there is more than one) so runner-ups in every tier can be ranked.
 */
export function resolveItem(participants: Participant[], rng: () => number = d100): Resolution {
  if (participants.length === 0) return { winnerId: null, winTier: null, entries: [] };

  const rolls = new Map<number, number>();
  if (participants.length > 1) {
    for (const p of participants) rolls.set(p.id, rng());
  }

  const entries: RollEntry[] = participants.map((p) => ({
    raiderId: p.id,
    username: p.username,
    tier: p.tier,
    roll: rolls.get(p.id) ?? null,
    itemLevel: p.itemLevel,
    won: false,
  }));

  const ranked = rankEntries(entries);
  const winner = ranked[0];
  winner.won = true;
  return { winnerId: winner.raiderId, winTier: winner.tier!, entries };
}

/**
 * Order entries best-first: by tier, then (Dibs only) item level, then roll.
 * The first element is the winner under the loot rules.
 */
export function rankEntries(entries: RollEntry[]): RollEntry[] {
  return [...entries].sort((a, b) => {
    const t = TIER_RANK[b.tier!] - TIER_RANK[a.tier!];
    if (t !== 0) return t;
    if (a.tier === 'dibs' && b.itemLevel !== a.itemLevel) return b.itemLevel - a.itemLevel;
    return (b.roll ?? 0) - (a.roll ?? 0);
  });
}

/** Top N entries per tier, each list best-first. */
export function rankByTier(entries: RollEntry[], n = 3): Record<Tier, RollEntry[]> {
  const out: Record<Tier, RollEntry[]> = { dibs: [], need: [], equip: [], greed: [] };
  for (const e of rankEntries(entries)) {
    const list = out[e.tier!];
    if (list.length < n) list.push(e);
  }
  return out;
}
