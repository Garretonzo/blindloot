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

/**
 * Decide who wins an item.
 * Highest tier present wins. Within Dibs (dibs): highest item level, ties broken by roll.
 * Within other tiers: highest 1-100 roll wins.
 * Every participant rolls (when there is more than one) so runner-ups in every tier can be ranked.
 */
export function resolveItem(participants: Participant[], rng: () => number = d100): Resolution {
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

  const winner = rankEntries(entries.filter((e) => e.tier !== 'pass'))[0];
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
  if (top === 'dibs') {
    const sameIlvl = others.filter((e) => e.itemLevel === winner.itemLevel);
    if (sameIlvl.length === 0) {
      return `${label} · ilvl ${winner.itemLevel} beat ${others.map((e) => `${e.username}'s ${e.itemLevel}`).join(', ')}.${outranked}`;
    }
    return `${label} · ilvl tie (${winner.itemLevel}) — rolled ${winner.roll} vs ${sameIlvl.map((e) => `${e.username} ${e.roll}`).join(', ')}.${outranked}`;
  }
  return `${label} · rolled ${winner.roll} vs ${others.map((e) => `${e.username} ${e.roll}`).join(', ')}.${outranked}`;
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
