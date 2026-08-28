/**
 * Grouping of resolved items into "batches" of results for the Batch Results card.
 * One batch = one resolution run: an instant batch, or one live roll-off start->finish
 * (items carry the run's start timestamp in `resolve_run`). Manual awards have no run
 * and collect into their own group; items resolved before the column existed collect
 * into a trailing "earlier" group.
 */

/** The fields grouping needs; any item-shaped row with them qualifies. */
export interface BatchSource {
  resolved_at: number | null;
  resolve_run: number | null;
  resolved_mode: 'batch' | 'live' | 'award' | null;
}

export interface BatchGroup<T> {
  key: string; // `run-${runId}` | 'awards' | 'earlier'
  kind: 'run' | 'awards' | 'earlier';
  /** The run's start (ms timestamp) for kind 'run'; null otherwise. */
  runId: number | null;
  /** Descending sort key: the run id, or for awards the latest award time. */
  sortAt: number;
  /** The group's items in resolution order (resolved_at asc, input order on ties). */
  items: T[];
}

/** Group resolved rows into result batches, most recent first; unresolved rows are dropped. */
export function groupBatches<T extends BatchSource>(rows: T[]): BatchGroup<T>[] {
  const runs = new Map<number, T[]>();
  const awards: T[] = [];
  const earlier: T[] = [];
  for (const r of rows) {
    if (r.resolved_at == null) continue;
    if (r.resolve_run != null) {
      let list = runs.get(r.resolve_run);
      if (!list) runs.set(r.resolve_run, (list = []));
      list.push(r);
    } else if (r.resolved_mode === 'award') awards.push(r);
    else earlier.push(r);
  }

  // Stable by-time sort within a group; input order (boss/item order) breaks ties.
  const byTime = (items: T[]) => [...items].sort((a, b) => a.resolved_at! - b.resolved_at!);

  const groups: BatchGroup<T>[] = [...runs.entries()].map(([runId, items]) => ({
    key: `run-${runId}`,
    kind: 'run' as const,
    runId,
    sortAt: runId,
    items: byTime(items),
  }));
  if (awards.length > 0) {
    groups.push({
      key: 'awards',
      kind: 'awards',
      runId: null,
      // Positioned among the runs by when the (latest) award happened.
      sortAt: Math.max(...awards.map((a) => a.resolved_at!)),
      items: byTime(awards),
    });
  }
  groups.sort((a, b) => b.sortAt - a.sortAt);
  if (earlier.length > 0) {
    // Pre-column data: no run to attribute it to, always last.
    groups.push({ key: 'earlier', kind: 'earlier', runId: null, sortAt: -Infinity, items: byTime(earlier) });
  }
  return groups;
}
