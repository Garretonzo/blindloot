import { describe, it, expect } from 'vitest';
import { sanitizeDetail } from './sanitize';
import { Item, Raider, SessionDetail } from '../shared/types';

const item = (id: number, winner: number | null, tier: Item['win_tier'], picked: Item['winner_picked_tier']): Item => ({
  id,
  boss_id: 1,
  name: `Item ${id}`,
  icon: null,
  sort_order: id,
  winner_raider_id: winner,
  win_tier: tier,
  resolved_at: winner != null ? 1 : null,
  resolved_mode: winner != null ? 'batch' : null,
  resolve_run: null,
  winner_picked_tier: picked,
});
const raider = (id: number): Raider => ({
  id,
  username: `r${id}`,
  avatar: null,
  item_level: 600,
  dibs_remaining: 1,
  need_remaining: 0,
  dibs_limit: 1,
  need_limit: 1,
});

const detail: SessionDetail = {
  session: { id: 1, season_id: 1, name: 'S', status: 'open', created_at: 0 },
  season: { id: 1, name: 'Se', raid_id: 'x', created_at: 0, dibs_per_season: 1, need_per_session: 1 },
  bosses: [{ id: 1, name: 'B', icon: null, sort_order: 1, items: [item(10, 7, 'need', 'dibs'), item(11, 8, 'dibs', 'dibs'), item(12, null, null, null)] }],
  raiders: [raider(7), raider(8)],
  revision: 5,
};

describe('sanitizeDetail', () => {
  it('shows the viewer their own win tier and pre-pick, and nobody else’s', () => {
    const out = sanitizeDetail(detail, 7);
    const [mine, theirs, open] = out.bosses[0].items;
    expect(mine).toMatchObject({ win_tier: 'need', my_picked_tier: 'dibs' });
    expect(theirs).toMatchObject({ win_tier: null, my_picked_tier: null });
    expect(open).toMatchObject({ win_tier: null, my_picked_tier: null });
  });

  it('never leaks winner_picked_tier', () => {
    for (const meId of [7, null]) {
      for (const i of sanitizeDetail(detail, meId).bosses[0].items) expect('winner_picked_tier' in i).toBe(false);
    }
  });

  it('keeps charge counts only for the viewer', () => {
    const [me, other] = sanitizeDetail(detail, 7).raiders;
    expect(me).toMatchObject({ id: 7, dibs_remaining: 1, need_remaining: 0 });
    expect(other.id).toBe(8);
    expect('dibs_remaining' in other).toBe(false);
    expect('need_remaining' in other).toBe(false);
  });

  it('an anonymous viewer sees no tiers and no charges', () => {
    const out = sanitizeDetail(detail, null);
    expect(out.bosses[0].items.every((i) => i.win_tier === null && i.my_picked_tier === null)).toBe(true);
    expect(out.raiders.every((r) => !('need_remaining' in r))).toBe(true);
  });

  it('passes the cache revision through and leaves the input untouched', () => {
    expect(sanitizeDetail(detail, 7).revision).toBe(5);
    expect(detail.bosses[0].items[0].winner_picked_tier).toBe('dibs');
    expect(detail.raiders[1].need_remaining).toBe(0);
  });
});
