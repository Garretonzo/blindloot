import { describe, it, expect } from 'vitest';
import {
  chunkString,
  insertStatements,
  Snapshot,
  SNAPSHOT_FORMAT,
  sqlLiteral,
  TABLE_COLUMNS,
  validateSnapshot,
} from './backup';

const emptySnapshot = (): Snapshot => ({
  format: SNAPSHOT_FORMAT,
  createdAt: 0,
  tables: {
    seasons: [],
    raiders: [],
    sessions: [],
    bosses: [],
    items: [],
    season_raiders: [],
    session_raiders: [],
    rolls: [],
    plans: [],
  },
});

describe('chunkString', () => {
  it('round-trips exactly', () => {
    const s = 'x'.repeat(2500) + 'middle' + 'y'.repeat(2500);
    expect(chunkString(s, 1000).join('')).toBe(s);
    expect(chunkString(s, 1000).every((c, i, all) => c.length <= 1001 || i === all.length - 1)).toBe(true);
  });

  it('never splits a surrogate pair at the chunk boundary', () => {
    // Place an emoji (2 UTF-16 code units) so the boundary lands between its halves.
    const s = 'a'.repeat(999) + '😀' + 'b'.repeat(50);
    const chunks = chunkString(s, 1000);
    expect(chunks.join('')).toBe(s);
    for (const c of chunks) {
      const last = c.charCodeAt(c.length - 1);
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false); // no chunk ends on a high surrogate
    }
  });

  it('handles empty input', () => {
    expect(chunkString('')).toEqual(['']);
  });
});

describe('sqlLiteral', () => {
  it('escapes quotes, passes integers, maps null', () => {
    expect(sqlLiteral("O'Neil ''x")).toBe("'O''Neil ''''x'");
    expect(sqlLiteral(42)).toBe('42');
    expect(sqlLiteral(null)).toBe('NULL');
  });

  it('rejects non-integer numbers', () => {
    expect(() => sqlLiteral(1.5)).toThrow();
  });
});

describe('insertStatements', () => {
  it('emits nothing for an empty table', () => {
    expect(insertStatements('rolls', [])).toEqual([]);
  });

  it('packs many rows into few statements, all under the size budget', () => {
    const rows = Array.from({ length: 5000 }, (_, i) => ({
      id: i + 1,
      item_id: 1,
      raider_id: 1,
      tier: 'need',
      picked_tier: null,
      roll_value: 55,
      won: 0,
    }));
    const stmts = insertStatements('rolls', rows);
    expect(stmts.length).toBeGreaterThan(0);
    expect(stmts.length).toBeLessThan(10); // literals pack far more than 100-param binding would
    for (const s of stmts) {
      expect(s.length).toBeLessThanOrEqual(100_000);
      expect(s.startsWith('INSERT INTO rolls (id, item_id, raider_id, tier, picked_tier, roll_value, won) VALUES ')).toBe(true);
    }
    // Every row is present exactly once.
    expect(stmts.join(';').match(/\(\d+, 1, 1, 'need', NULL, 55, 0\)/g)!.length).toBe(5000);
  });
});

describe('validateSnapshot', () => {
  it('accepts a well-formed snapshot', () => {
    const snap = emptySnapshot();
    snap.tables.raiders.push({ id: 1, username: 'a😀b', created_at: 5, password_hash: null });
    expect(() => validateSnapshot(snap)).not.toThrow();
  });

  it('rejects a wrong format tag', () => {
    expect(() => validateSnapshot({ ...emptySnapshot(), format: 'nope' })).toThrow(/backup file/);
  });

  it('rejects unknown and missing tables', () => {
    const extra = emptySnapshot() as unknown as { tables: Record<string, unknown> };
    extra.tables.evil = [];
    expect(() => validateSnapshot(extra)).toThrow(/unknown table/);

    const missing = emptySnapshot() as unknown as { tables: Record<string, unknown> };
    delete missing.tables.rolls;
    expect(() => validateSnapshot(missing)).toThrow(/missing/);
  });

  it('rejects rows with extra, missing or wrongly-typed columns', () => {
    const extraCol = emptySnapshot();
    extraCol.tables.plans.push({ session_id: 1, item_id: 1, raider_id: 1, tier: 'need', evil: 1 } as never);
    expect(() => validateSnapshot(extraCol)).toThrow(/shape/);

    const missingCol = emptySnapshot();
    missingCol.tables.plans.push({ session_id: 1, item_id: 1, raider_id: 1 } as never);
    expect(() => validateSnapshot(missingCol)).toThrow(/shape/);

    const badType = emptySnapshot();
    badType.tables.plans.push({ session_id: 1, item_id: 1, raider_id: 1, tier: { a: 1 } } as never);
    expect(() => validateSnapshot(badType)).toThrow(/bad value type/);

    const float = emptySnapshot();
    float.tables.plans.push({ session_id: 1.5, item_id: 1, raider_id: 1, tier: 'need' } as never);
    expect(() => validateSnapshot(float)).toThrow(/non-integer/);
  });

  it('column lists cover every table', () => {
    expect(Object.keys(TABLE_COLUMNS).sort()).toEqual(
      ['bosses', 'items', 'plans', 'raiders', 'rolls', 'season_raiders', 'seasons', 'session_raiders', 'sessions'].sort(),
    );
  });
});
