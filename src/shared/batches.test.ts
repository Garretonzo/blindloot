import { describe, it, expect } from 'vitest';
import { groupBatches, BatchSource } from './batches';

const row = (resolved_at: number | null, resolve_run: number | null, resolved_mode: BatchSource['resolved_mode'], name = ''): BatchSource & { name: string } => ({
  resolved_at,
  resolve_run,
  resolved_mode,
  name,
});

describe('groupBatches', () => {
  it('returns [] for empty input and drops unresolved rows', () => {
    expect(groupBatches([])).toEqual([]);
    expect(groupBatches([row(null, null, null)])).toEqual([]);
  });

  it('orders runs most recent first, items within a run by resolution time', () => {
    const groups = groupBatches([
      row(1005, 1000, 'batch', 'a2'),
      row(1001, 1000, 'batch', 'a1'),
      row(2001, 2000, 'live', 'b1'),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['run-2000', 'run-1000']);
    expect(groups[1].items.map((i) => i.name)).toEqual(['a1', 'a2']);
    expect(groups[0].kind).toBe('run');
    expect(groups[0].runId).toBe(2000);
  });

  it('keeps mixed modes with the same run together (re-award keeps its run)', () => {
    const groups = groupBatches([
      row(1001, 1000, 'live', 'rolled'),
      row(1002, 1000, 'award', 're-awarded'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((i) => i.name)).toEqual(['rolled', 're-awarded']);
  });

  it('collects run-less awards into one group positioned by latest award time', () => {
    const groups = groupBatches([
      row(1001, 1000, 'batch', 'old-batch'),
      row(1500, null, 'award', 'award-mid'),
      row(2001, 2000, 'batch', 'new-batch'),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['run-2000', 'awards', 'run-1000']);
    expect(groups[1].kind).toBe('awards');
    // A later award moves the whole group up.
    const groups2 = groupBatches([
      row(1001, 1000, 'batch'),
      row(1500, null, 'award'),
      row(2500, null, 'award'),
      row(2001, 2000, 'batch'),
    ]);
    expect(groups2.map((g) => g.key)).toEqual(['awards', 'run-2000', 'run-1000']);
  });

  it('collapses legacy run-less rows into one trailing earlier group, even when newest', () => {
    const groups = groupBatches([
      row(9999, null, 'batch', 'legacy-batch'),
      row(9998, null, 'live', 'legacy-live'),
      row(1001, 1000, 'batch', 'tracked'),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['run-1000', 'earlier']);
    expect(groups[1].kind).toBe('earlier');
    expect(groups[1].items.map((i) => i.name)).toEqual(['legacy-live', 'legacy-batch']);
  });
});
