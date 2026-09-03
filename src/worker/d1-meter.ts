/**
 * Dev-only D1 accounting. Wraps a D1Database so every statement's `meta.rows_read` /
 * `rows_written` is summed (and optionally reported per statement), which is what the free
 * tier's daily cap counts. Enabled by `D1_METER=1` in `.dev.vars`; never set in production.
 * `.first()` is routed through `.all()` because only all/run/batch expose meta.
 */
export interface D1Meter {
  rowsRead: number;
  rowsWritten: number;
  queries: number;
  onQuery?: (sql: string, rowsRead: number, rowsWritten: number) => void;
}

export const newMeter = (onQuery?: D1Meter['onQuery']): D1Meter => ({ rowsRead: 0, rowsWritten: 0, queries: 0, onQuery });

const RAW = Symbol('d1-meter-raw');
type Meta = { rows_read?: number; rows_written?: number } | undefined;

export function meteredDb(db: D1Database, meter: D1Meter): D1Database {
  const record = (sql: string, meta: Meta) => {
    const r = meta?.rows_read ?? 0;
    const w = meta?.rows_written ?? 0;
    meter.rowsRead += r;
    meter.rowsWritten += w;
    meter.queries += 1;
    meter.onQuery?.(sql, r, w);
  };
  const wrap = (stmt: D1PreparedStatement, sql: string): D1PreparedStatement => {
    const wrapped = {
      [RAW]: stmt,
      bind: (...values: unknown[]) => wrap(stmt.bind(...values), sql),
      all: async <T>() => {
        const res = await stmt.all<T>();
        record(sql, res.meta);
        return res;
      },
      run: async <T>() => {
        const res = await stmt.run<T>();
        record(sql, res.meta);
        return res;
      },
      first: async (col?: string) => {
        const res = await stmt.all<Record<string, unknown>>();
        record(sql, res.meta);
        const row = res.results[0];
        if (row === undefined) return null;
        return col === undefined ? row : (row[col] ?? null);
      },
      raw: (...args: unknown[]) => (stmt.raw as (...a: unknown[]) => Promise<unknown[]>)(...args),
    };
    return wrapped as unknown as D1PreparedStatement;
  };
  return new Proxy(db, {
    get(target, prop) {
      if (prop === 'prepare') return (sql: string) => wrap(target.prepare(sql), sql);
      if (prop === 'batch') {
        return async <T>(stmts: D1PreparedStatement[]) => {
          const res = await target.batch<T>(stmts.map((s) => (s as unknown as Record<symbol, D1PreparedStatement>)[RAW] ?? s));
          for (const r of res) record('(batch)', r.meta);
          return res;
        };
      }
      const v = Reflect.get(target, prop, target);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}
