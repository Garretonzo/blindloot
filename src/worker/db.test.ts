import { describe, it, expect } from 'vitest';
import { eligibilityIndex } from './db';

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
