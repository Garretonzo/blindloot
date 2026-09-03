import { describe, it, expect } from 'vitest';
import { buildPlanPreview, eligibilityIndex } from './db';
import { Item, Raider, SessionDetail } from '../shared/types';

const limits = { need_per_session: 1, dibs_per_season: 1 };
const item = (id: number, winner: number | null, tier: 'need' | 'dibs' | 'equip' | 'greed' | null) => ({ id, winner_raider_id: winner, win_tier: tier });

describe('eligibilityIndex (in-memory twin of raiderEligibility)', () => {
  it('a raider with no wins has Need and Dibs available', () => {
    const e = eligibilityIndex(limits, [item(1, null, null)], []);
    expect(e.eligibilityFor(7, 0)).toEqual({ needAvailable: true, canDibs: true });
  });

  it('a Need win this session spends Need, which also locks Dibs', () => {
    const e = eligibilityIndex(limits, [item(1, 7, 'need')], []);
    expect(e.eligibilityFor(7, 0)).toEqual({ needAvailable: false, canDibs: false });
    expect(e.eligibilityFor(8, 0)).toEqual({ needAvailable: true, canDibs: true });
  });

  it('a Dibs win this session spends both (it appears in both inputs, as it would from D1)', () => {
    const e = eligibilityIndex(limits, [item(1, 7, 'dibs')], [item(1, 7, 'dibs')]);
    expect(e.eligibilityFor(7, 0)).toEqual({ needAvailable: false, canDibs: false });
  });

  it('a Dibs win in another session of the season spends Dibs only', () => {
    const e = eligibilityIndex(limits, [], [item(99, 7, 'dibs')]);
    expect(e.eligibilityFor(7, 0)).toEqual({ needAvailable: true, canDibs: false });
  });

  it('ignores the item being re-awarded', () => {
    const e = eligibilityIndex(limits, [item(1, 7, 'dibs')], [item(1, 7, 'dibs')]);
    expect(e.eligibilityFor(7, 1)).toEqual({ needAvailable: true, canDibs: true });
    expect(e.eligibilityFor(7, 2)).toEqual({ needAvailable: false, canDibs: false });
  });

  it('Equip / Transmog wins cost nothing', () => {
    const e = eligibilityIndex(limits, [item(1, 7, 'equip'), item(2, 7, 'greed')], []);
    expect(e.eligibilityFor(7, 0)).toEqual({ needAvailable: true, canDibs: true });
  });

  it('honours higher limits', () => {
    const e = eligibilityIndex({ need_per_session: 2, dibs_per_season: 2 }, [item(1, 7, 'need')], []);
    expect(e.eligibilityFor(7, 0)).toEqual({ needAvailable: true, canDibs: true });
  });

  it('treats an unknown session as fully spent', () => {
    expect(eligibilityIndex(null, [], []).eligibilityFor(7, 0)).toEqual({ needAvailable: false, canDibs: false });
  });
});

const detailItem = (id: number, name: string, winner: number | null = null): Item => ({
  id,
  boss_id: 1,
  name,
  icon: null,
  sort_order: id,
  winner_raider_id: winner,
  win_tier: winner != null ? 'need' : null,
  resolved_at: winner != null ? 1 : null,
  resolved_mode: winner != null ? 'batch' : null,
  resolve_run: null,
});
const detailRaider = (id: number, username: string, need = 1, dibs = 1): Raider => ({
  id,
  username,
  avatar: null,
  item_level: 600,
  dibs_remaining: dibs,
  need_remaining: need,
  dibs_limit: 1,
  need_limit: 1,
});
const detailOf = (items: Item[], raiders: Raider[]): SessionDetail => ({
  session: { id: 1, season_id: 1, name: 'S', status: 'open', created_at: 0 },
  season: { id: 1, name: 'Se', raid_id: 'x', created_at: 0, dibs_per_season: 1, need_per_session: 1 },
  bosses: [{ id: 1, name: 'B', icon: null, sort_order: 1, items }],
  raiders,
});
const row = (item_id: number, raider_id: number, tier: 'pass' | 'greed' | 'offspec' | 'equip' | 'need' | 'dibs') => ({ item_id, raider_id, tier });

describe('buildPlanPreview', () => {
  const fresh = detailOf([detailItem(10, 'Sword'), detailItem(11, 'Shield')], [detailRaider(1, 'bob'), detailRaider(2, 'Alice')]);

  it('keeps a pick a raider can still afford', () => {
    const v = buildPlanPreview(fresh, [row(10, 1, 'dibs'), row(11, 1, 'need')], 4);
    expect(v.items[10][0]).toMatchObject({ raiderId: 1, username: 'bob', tier: 'dibs', effectiveTier: 'dibs' });
    expect(v.items[11][0].effectiveTier).toBe('need');
  });

  it('demotes from the stored counters: Need→Equip, Dibs→Need, Dibs→Equip', () => {
    const noNeed = detailOf(fresh.bosses[0].items, [detailRaider(1, 'bob', 0, 1)]);
    expect(buildPlanPreview(noNeed, [row(10, 1, 'need')], 0).items[10][0].effectiveTier).toBe('equip');
    expect(buildPlanPreview(noNeed, [row(10, 1, 'dibs')], 0).items[10][0].effectiveTier).toBe('equip');
    const noDibs = detailOf(fresh.bosses[0].items, [detailRaider(1, 'bob', 1, 0)]);
    expect(buildPlanPreview(noDibs, [row(10, 1, 'dibs')], 0).items[10][0].effectiveTier).toBe('need');
  });

  it('honours an admin override of the counters', () => {
    const generous = detailOf(fresh.bosses[0].items, [detailRaider(1, 'bob', 2, 0)]);
    expect(buildPlanPreview(generous, [row(10, 1, 'need')], 0).items[10][0].effectiveTier).toBe('need');
  });

  it('marks a pick on a copy of an already-won item as Pass, and leaves Pass alone', () => {
    const d = detailOf([detailItem(9, 'Sword', 1), detailItem(10, 'Sword'), detailItem(11, 'Shield')], [detailRaider(1, 'bob')]);
    const v = buildPlanPreview(d, [row(10, 1, 'dibs'), row(11, 1, 'pass')], 0);
    expect(v.items[10][0]).toMatchObject({ tier: 'dibs', effectiveTier: 'pass' });
    expect(v.items[11][0]).toMatchObject({ tier: 'pass', effectiveTier: 'pass' });
  });

  it('drops rows on resolved or unknown items and from raiders no longer in the session', () => {
    const d = detailOf([detailItem(9, 'Sword', 2), detailItem(10, 'Axe')], [detailRaider(1, 'bob')]);
    const v = buildPlanPreview(d, [row(9, 1, 'need'), row(99, 1, 'need'), row(10, 7, 'need'), row(10, 1, 'greed')], 0);
    expect(Object.keys(v.items)).toEqual(['10']);
    expect(v.items[10]).toHaveLength(1);
    expect(v.summary).toEqual({ raiders: [{ raiderId: 1, picks: 1 }], unresolvedItems: 1 });
  });

  it('counts passes in the per-raider summary and reports unresolved items', () => {
    const v = buildPlanPreview(fresh, [row(10, 1, 'pass'), row(11, 1, 'need'), row(10, 2, 'greed')], 0);
    expect(v.summary.raiders).toEqual(expect.arrayContaining([{ raiderId: 1, picks: 2 }, { raiderId: 2, picks: 1 }]));
    expect(v.summary.unresolvedItems).toBe(2);
  });

  it('orders each item’s picks by username, case-insensitively, and echoes plansRevision', () => {
    const v = buildPlanPreview(fresh, [row(10, 1, 'need'), row(10, 2, 'need')], 12);
    expect(v.items[10].map((p) => p.username)).toEqual(['Alice', 'bob']);
    expect(v.plansRevision).toBe(12);
  });
});
