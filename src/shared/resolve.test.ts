import { describe, it, expect } from 'vitest';
import { orderItemsByPriority, resolveItem, rankByTier, explainResult, Participant, WinCounts } from './resolve';
import { Tier } from './types';

const p = (id: number, tier: Participant['tier'], itemLevel = 600): Participant => ({
  id,
  username: `r${id}`,
  itemLevel,
  tier,
});

const seq = (...vals: number[]) => {
  let i = 0;
  return () => vals[i++ % vals.length];
};

describe('resolveItem', () => {
  it('returns no winner with no participants', () => {
    expect(resolveItem([])).toEqual({ winnerId: null, winTier: null, entries: [] });
  });

  it('single participant wins without rolling', () => {
    const r = resolveItem([p(1, 'greed')]);
    expect(r.winnerId).toBe(1);
    expect(r.entries[0].roll).toBeNull();
  });

  it('higher tier beats lower tier regardless of roll', () => {
    const r = resolveItem([p(1, 'greed'), p(2, 'equip'), p(3, 'need')], seq(100, 100, 1));
    expect(r.winnerId).toBe(3);
    expect(r.winTier).toBe('need');
  });

  it('everyone rolls so lower tiers can be ranked', () => {
    const r = resolveItem([p(1, 'greed'), p(2, 'need')], seq(42, 7));
    expect(r.entries.map((e) => e.roll)).toEqual([42, 7]);
  });

  it('pass never wins, even alone, but is recorded', () => {
    const alone = resolveItem([p(1, 'pass')]);
    expect(alone.winnerId).toBeNull();
    expect(alone.entries).toHaveLength(1);
    const r = resolveItem([p(1, 'pass'), p(2, 'greed')], seq(1, 1));
    expect(r.winnerId).toBe(2);
    expect(r.entries.find((e) => e.raiderId === 1)!.roll).toBeNull();
  });

  it('off-spec beats transmog and loses to equip', () => {
    expect(resolveItem([p(1, 'greed'), p(2, 'offspec')], seq(100, 1)).winnerId).toBe(2);
    expect(resolveItem([p(1, 'offspec'), p(2, 'equip')], seq(100, 1)).winnerId).toBe(2);
  });

  it('dibs beats need', () => {
    const r = resolveItem([p(1, 'need'), p(2, 'dibs')]);
    expect(r.winnerId).toBe(2);
    expect(r.winTier).toBe('dibs');
  });

  it('two dibss: higher item level wins', () => {
    const r = resolveItem([p(1, 'dibs', 610), p(2, 'dibs', 620)], seq(100, 1));
    expect(r.winnerId).toBe(2);
  });

  it('two dibss with equal ilvl: roll decides', () => {
    const r = resolveItem([p(1, 'dibs', 610), p(2, 'dibs', 610)], seq(10, 90));
    expect(r.winnerId).toBe(2);
  });

  it('same tier: highest roll wins', () => {
    const r = resolveItem([p(1, 'equip'), p(2, 'equip'), p(3, 'equip')], seq(50, 99, 1));
    expect(r.winnerId).toBe(2);
  });
});

describe('orderItemsByPriority', () => {
  const plans = (m: Record<number, Tier[]>) => new Map(Object.entries(m).map(([k, v]) => [Number(k), v]));

  it('groups by top tier: dibs, need, equip, offspec, greed, then unplanned', () => {
    const order = orderItemsByPriority(
      [1, 2, 3, 4, 5, 6],
      plans({ 1: ['greed'], 2: ['equip'], 3: ['dibs'], 4: ['offspec'], 5: ['need'] }), // 6 has no plans
    );
    expect(order).toEqual([3, 5, 2, 4, 1, 6]);
  });

  it('within a group, fewer top-tier planners go first', () => {
    const order = orderItemsByPriority([1, 2], plans({ 1: ['dibs', 'dibs'], 2: ['dibs'] }));
    expect(order).toEqual([2, 1]);
  });

  it('tier trumps count: one dibs beats five need', () => {
    const order = orderItemsByPriority([1, 2], plans({ 1: ['need', 'need', 'need', 'need', 'need'], 2: ['dibs'] }));
    expect(order).toEqual([2, 1]);
  });

  it('only top-tier planners count toward the tie-break', () => {
    // Item 1: 1 dibs + 4 need. Item 2: 2 dibs. Item 1 first (1 < 2 at the top tier).
    const order = orderItemsByPriority([2, 1], plans({ 1: ['dibs', 'need', 'need', 'need', 'need'], 2: ['dibs', 'dibs'] }));
    expect(order).toEqual([1, 2]);
  });

  it('pass-only plans count as unplanned', () => {
    const order = orderItemsByPriority([1, 2], plans({ 1: ['pass', 'pass'], 2: ['greed'] }));
    expect(order).toEqual([2, 1]);
  });

  it('ties keep input order (caller pre-shuffles for randomness)', () => {
    expect(orderItemsByPriority([3, 1, 2], plans({ 1: ['equip'], 2: ['equip'], 3: ['equip'] }))).toEqual([3, 1, 2]);
    expect(orderItemsByPriority([2, 3, 1], plans({ 1: ['equip'], 2: ['equip'], 3: ['equip'] }))).toEqual([2, 3, 1]);
  });
});

describe('resolveItem win equalization', () => {
  it('fewest wins at the tier beats a higher roll', () => {
    const counts: WinCounts = { 1: { equip: 1 } };
    const r = resolveItem([p(1, 'equip'), p(2, 'equip')], seq(99, 1), counts);
    expect(r.winnerId).toBe(2);
    // The filtered-out roller still rolled and is recorded.
    expect(r.entries.find((e) => e.raiderId === 1)!.roll).toBe(99);
  });

  it('counters are per-tier: greed wins do not hurt equip eligibility', () => {
    const counts: WinCounts = { 1: { greed: 3 } };
    const r = resolveItem([p(1, 'equip'), p(2, 'equip')], seq(99, 1), counts);
    expect(r.winnerId).toBe(1);
  });

  it('tier hierarchy trumps the filter: equip with wins still beats offspec with none', () => {
    const counts: WinCounts = { 1: { equip: 5 } };
    const r = resolveItem([p(1, 'equip'), p(2, 'offspec')], seq(1, 99), counts);
    expect(r.winnerId).toBe(1);
    expect(r.winTier).toBe('equip');
  });

  it('dibs contest: min-wins filter applies first, then ilvl decides among eligible', () => {
    const counts: WinCounts = { 1: { dibs: 1 } };
    // 1 has the higher ilvl but a dibs win already; 2 and 3 are tied at 0 → ilvl decides between them.
    const r = resolveItem([p(1, 'dibs', 650), p(2, 'dibs', 620), p(3, 'dibs', 630)], seq(99, 98, 1), counts);
    expect(r.winnerId).toBe(3);
  });

  it('need contest with counts filters likewise', () => {
    const counts: WinCounts = { 1: { need: 1 } };
    const r = resolveItem([p(1, 'need'), p(2, 'need')], seq(99, 1), counts);
    expect(r.winnerId).toBe(2);
  });

  it('all tied at the minimum: highest roll wins as before', () => {
    const counts: WinCounts = { 1: { equip: 2 }, 2: { equip: 2 } };
    const r = resolveItem([p(1, 'equip'), p(2, 'equip')], seq(40, 90), counts);
    expect(r.winnerId).toBe(2);
  });

  it('no winCounts: legacy behavior', () => {
    const r = resolveItem([p(1, 'equip'), p(2, 'equip')], seq(99, 1));
    expect(r.winnerId).toBe(1);
  });

  it('equalized winner ranks first among its tier in ranked views', () => {
    const counts: WinCounts = { 1: { equip: 1 } };
    const r = resolveItem([p(1, 'equip'), p(2, 'equip')], seq(99, 1), counts);
    const ranked = rankByTier(r.entries);
    expect(ranked.equip.map((e) => e.raiderId)).toEqual([2, 1]);
  });

  it('explainResult calls out an equalized win', () => {
    const counts: WinCounts = { 1: { equip: 1 } };
    const r = resolveItem([p(1, 'equip'), p(2, 'equip')], seq(99, 1), counts);
    expect(explainResult(r.entries)).toBe('Equip · rolled 1 (win-equalized: fewest wins go first) vs r1 99.');
  });
});

describe('explainResult', () => {
  const ex = (ps: Participant[], ...rolls: number[]) => explainResult(resolveItem(ps, seq(...(rolls.length ? rolls : [1]))).entries);
  it('covers every branch', () => {
    expect(ex([])).toBe('Nobody rolled.');
    expect(ex([p(1, 'pass')])).toBe('Nobody rolled.');
    expect(ex([p(1, 'equip')])).toBe('Uncontested Equip.');
    expect(ex([p(1, 'need'), p(2, 'greed')], 50, 60)).toBe('Uncontested Need. Outranked 1 lower pick.');
    expect(ex([p(1, 'need'), p(2, 'need')], 91, 77)).toBe('Need · rolled 91 vs r2 77.');
    expect(ex([p(1, 'dibs', 625), p(2, 'dibs', 618)], 1, 99)).toBe("Dibs · ilvl 625 beat r2's 618.");
    expect(ex([p(1, 'dibs', 620), p(2, 'dibs', 620), p(3, 'equip')], 87, 43, 99)).toBe('Dibs · ilvl tie (620) — rolled 87 vs r2 43. Outranked 1 lower pick.');
  });
});

describe('rankByTier', () => {
  it('groups top 3 per tier best-first', () => {
    const r = resolveItem(
      [p(1, 'equip'), p(2, 'equip'), p(3, 'equip'), p(4, 'equip'), p(5, 'greed'), p(6, 'dibs', 600), p(7, 'dibs', 650)],
      seq(10, 40, 30, 20, 5, 99, 1),
    );
    const ranked = rankByTier(r.entries);
    expect(ranked.dibs.map((e) => e.raiderId)).toEqual([7, 6]);
    expect(ranked.equip.map((e) => e.raiderId)).toEqual([2, 3, 4]);
    expect(ranked.greed.map((e) => e.raiderId)).toEqual([5]);
    expect(ranked.need).toEqual([]);
  });
});
