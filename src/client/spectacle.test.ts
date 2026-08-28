import { describe, it, expect } from 'vitest';
import { bestWinTier, hypeFor, HYPE, isFreshReveal, JUNK, junkFor, REVEAL_GRACE_MS, winsForRun, wrapFor } from './spectacle';
import { Boss, Item } from '../shared/types';

const item = (over: Partial<Item>): Item => ({
  id: 1,
  boss_id: 1,
  name: 'Thing',
  icon: null,
  sort_order: 1,
  winner_raider_id: null,
  win_tier: null,
  resolved_at: null,
  resolved_mode: null,
  resolve_run: null,
  ...over,
});

describe('isFreshReveal', () => {
  const reveal = { revealAt: 100_000 };
  it('true mid-countdown and within grace, false beyond', () => {
    expect(isFreshReveal(reveal, reveal.revealAt - 4000)).toBe(true);
    expect(isFreshReveal(reveal, reveal.revealAt + REVEAL_GRACE_MS - 1)).toBe(true);
    expect(isFreshReveal(reveal, reveal.revealAt + REVEAL_GRACE_MS)).toBe(false);
  });
});

describe('winsForRun', () => {
  const bosses: Boss[] = [
    {
      id: 1,
      name: 'Boss A',
      icon: null,
      sort_order: 1,
      items: [
        item({ id: 1, name: 'Mine', resolve_run: 500, winner_raider_id: 7, resolved_at: 501 }),
        item({ id: 2, name: 'Other winner', resolve_run: 500, winner_raider_id: 8, resolved_at: 502 }),
        item({ id: 3, name: 'Other run', resolve_run: 400, winner_raider_id: 7, resolved_at: 401 }),
        item({ id: 4, name: 'Unresolved' }),
      ],
    },
    { id: 2, name: 'Boss B', icon: null, sort_order: 2, items: [item({ id: 5, name: 'Also mine', resolve_run: 500, winner_raider_id: 7, resolved_at: 503 })] },
  ];

  it('filters by run and winner and attaches boss names', () => {
    const wins = winsForRun(bosses, 500, 7);
    expect(wins.map((w) => [w.name, w.bossName])).toEqual([
      ['Mine', 'Boss A'],
      ['Also mine', 'Boss B'],
    ]);
  });

  it('empty for a raider with no wins in the run', () => {
    expect(winsForRun(bosses, 500, 99)).toEqual([]);
  });
});

describe('bestWinTier / wrapFor', () => {
  it('empty and null tiers give no best', () => {
    expect(bestWinTier([])).toBeNull();
    expect(bestWinTier([{ win_tier: null }])).toBeNull();
  });
  it('picks the highest rank', () => {
    expect(bestWinTier([{ win_tier: 'equip' }, { win_tier: 'dibs' }, { win_tier: 'offspec' }])).toBe('dibs');
  });
  it('wrapFor maps all four branches', () => {
    expect(wrapFor('dibs')).toBe('gold');
    expect(wrapFor('need')).toBe('gold');
    expect(wrapFor('equip')).toBe('teal');
    expect(wrapFor('offspec')).toBe('plain');
    expect(wrapFor('greed')).toBe('plain');
    expect(wrapFor(null)).toBe('soggy');
  });
});

describe('junkFor', () => {
  it('is deterministic per (runId, raiderId)', () => {
    const first = junkFor(1787950627825, 7);
    for (let i = 0; i < 100; i++) expect(junkFor(1787950627825, 7)).toEqual(first);
  });
  it('always lands in the junk list', () => {
    for (let run = 0; run < 50; run++) {
      for (let raider = 1; raider < 20; raider++) {
        expect(JUNK).toContainEqual(junkFor(run * 997, raider));
      }
    }
  });
  it('varies across raiders for a fixed run', () => {
    const names = new Set(Array.from({ length: 40 }, (_, r) => junkFor(123456789, r).name));
    expect(names.size).toBeGreaterThan(1);
  });
});

describe('hypeFor', () => {
  it('stays in bounds and is stable per second', () => {
    for (let s = 0; s <= 5; s += 0.1) {
      expect(HYPE).toContain(hypeFor(s));
      expect(hypeFor(s)).toBe(hypeFor(Math.ceil(s * 10) / 10 - 0.05 > 0 ? s : s)); // stable within the same ceil-second
    }
    expect(hypeFor(3.2)).toBe(hypeFor(3.9));
  });
});
