import { describe, it, expect } from 'vitest';
import { resolveItem, rankByTier, explainResult, Participant } from './resolve';

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
