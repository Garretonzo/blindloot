/**
 * Pure logic for the instant-batch spectacle (countdown -> explosion -> present -> reveal).
 * Kept out of the component so it's testable without a DOM.
 */
import { Boss, Item, Tier, TIER_RANK } from '../shared/types';

/** How long after revealAt a reveal may still be shown. Beyond this it never shows (no replays). */
export const REVEAL_GRACE_MS = 30_000;

/** Should a just-received reveal actually be shown? Joining mid-countdown is fine; older = never. */
export const isFreshReveal = (reveal: { revealAt: number }, now: number, grace = REVEAL_GRACE_MS) =>
  now < reveal.revealAt + grace;

export interface WonItem extends Item {
  bossName: string;
}

/** The viewer's wins in one resolution run, with boss names attached. */
export function winsForRun(bosses: Boss[], runId: number, raiderId: number): WonItem[] {
  return bosses.flatMap((b) =>
    b.items.filter((i) => i.resolve_run === runId && i.winner_raider_id === raiderId).map((i) => ({ ...i, bossName: b.name })),
  );
}

/** Highest win_tier among the viewer's wins (the server sends win_tier only on own wins). */
export function bestWinTier(items: Pick<Item, 'win_tier'>[]): Tier | null {
  let best: Tier | null = null;
  for (const i of items) {
    if (i.win_tier && (best == null || TIER_RANK[i.win_tier] > TIER_RANK[best])) best = i.win_tier;
  }
  return best;
}

/** Present wrapping by best win: gold (Dibs/Need) | teal (Equip) | plain (Off-spec/Transmog) | soggy cardboard (no loot). */
export type WrapTier = 'gold' | 'teal' | 'plain' | 'soggy';
export const wrapFor = (best: Tier | null): WrapTier =>
  best === 'dibs' || best === 'need' ? 'gold' : best === 'equip' ? 'teal' : best != null ? 'plain' : 'soggy';

export interface JunkItem {
  emoji: string;
  name: string;
  flavor: string;
}

/** The consolation junk drawer. Poor quality. Very poor. */
export const JUNK: JunkItem[] = [
  { emoji: '🪨', name: 'A Rock', flavor: 'It is a rock. It does nothing. Like your DPS.' },
  { emoji: '💩', name: 'Fresh Ram Dung', flavor: 'Still warm. The ram apologizes for nothing.' },
  { emoji: '🧦', name: 'Single Damp Sock', flavor: 'The other one dropped for someone else. Of course it did.' },
  { emoji: '🥔', name: 'Suspicious Potato', flavor: 'It has eyes. They have seen your rolls.' },
  { emoji: '🍂', name: 'Handful of Leaves', flavor: "Nature's participation trophy." },
  { emoji: '🪵', name: 'Log', flavor: 'You can check it later to see who out-rolled you.' },
  { emoji: '🥄', name: 'Slightly Bent Spoon', flavor: 'There is no loot.' },
  { emoji: '🧅', name: 'Onion of Sorrow', flavor: "It's okay to cry." },
];

/** Deterministic pick per raider+run so re-renders and reconnects never reshuffle their misery. */
export function junkFor(runId: number, raiderId: number): JunkItem {
  let h = (runId ^ Math.imul(raiderId, 2654435761)) >>> 0; // 32-bit mix
  h = Math.imul(h ^ (h >>> 16), 2246822519) >>> 0;
  return JUNK[h % JUNK.length];
}

/** Rotating countdown hype lines, one per second. */
export const HYPE = ['PRAY TO RNGESUS', 'OH SHIT', 'NO TAKESIES BACKSIES', 'OH FUCK', "DIBS DON'T LIE"];
export const hypeFor = (secondsLeft: number) => HYPE[Math.max(0, Math.ceil(secondsLeft)) % HYPE.length];
