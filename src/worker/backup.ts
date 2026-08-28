/**
 * Restore points and file export/import.
 *
 * A snapshot is a full-fidelity JSON copy of every app table (ids and password hashes
 * included) so a restore reproduces the database exactly. Snapshots are stored inside D1
 * itself (`backups` + `backup_chunks`, which are never part of a snapshot) and double as
 * the download/upload file format.
 *
 * Restore replaces all app-table contents in one transactional db.batch(): deletes
 * children-first, re-inserts parents-first with original ids inlined as SQL literals
 * (bound params are capped at 100 per statement; literals pack ~1000 rows per statement
 * under D1's 100KB SQL-text limit). sqlite_sequence is deliberately untouched — explicit
 * ids only ever bump it upward, so post-restore inserts can't collide.
 */

export const SNAPSHOT_FORMAT = 'jfr-backup-v1';

export type BackupKind = 'manual' | 'pre-restore' | 'pre-import';

/** Column lists per table: the single source of truth for snapshot SELECTs, restore INSERTs and import validation. */
export const TABLE_COLUMNS = {
  seasons: ['id', 'name', 'raid_id', 'created_at', 'dibs_per_season', 'need_per_session'],
  raiders: ['id', 'username', 'created_at', 'password_hash', 'avatar'],
  sessions: ['id', 'season_id', 'name', 'status', 'created_at'],
  bosses: ['id', 'session_id', 'name', 'icon', 'sort_order'],
  items: ['id', 'boss_id', 'name', 'icon', 'sort_order', 'winner_raider_id', 'win_tier', 'resolved_at', 'resolved_mode', 'resolve_run'],
  season_raiders: ['season_id', 'raider_id', 'dibs_remaining'],
  session_raiders: ['session_id', 'raider_id', 'item_level', 'need_remaining', 'joined_at'],
  rolls: ['id', 'item_id', 'raider_id', 'tier', 'picked_tier', 'roll_value', 'won'],
  plans: ['session_id', 'item_id', 'raider_id', 'tier'],
} as const;

export type TableName = keyof typeof TABLE_COLUMNS;

/** Columns added after older backups were taken: may be absent from snapshot rows (restored as NULL). */
export const OPTIONAL_COLUMNS: { [T in TableName]?: readonly string[] } = {
  raiders: ['avatar'],
  items: ['resolve_run'],
};

/** Parents before children, so inserts satisfy D1's (always-on) foreign key enforcement. */
export const INSERT_ORDER: TableName[] = [
  'seasons',
  'raiders',
  'sessions',
  'bosses',
  'items',
  'season_raiders',
  'session_raiders',
  'rolls',
  'plans',
];

/** Children before parents, for the delete pass. */
export const DELETE_ORDER: TableName[] = [...INSERT_ORDER].reverse();

export type SnapshotRow = Record<string, string | number | null>;

export interface Snapshot {
  format: typeof SNAPSHOT_FORMAT;
  createdAt: number;
  tables: Record<TableName, SnapshotRow[]>;
}

export interface BackupMeta {
  id: number;
  name: string;
  kind: BackupKind;
  created_at: number;
  bytes: number;
}

// D1 caps SQL statement text at 100KB and any single value/row at 2MB. Chunks are bound
// parameters (so only the 2MB cap applies): 250k UTF-16 code units is ≤750KB even if
// every character is 3-byte UTF-8. Statements are packed to ~90KB of inlined text.
const CHUNK_CODE_UNITS = 250_000;
const STATEMENT_TEXT_BUDGET = 90_000;
/** Refuse new manual backups once the stored total passes this (the DB itself caps at 500MB on free). */
export const MAX_TOTAL_BACKUP_BYTES = 100 * 1024 * 1024;
/** Auto-created safety backups kept per kind. */
const AUTO_KEEP = 3;

// ---- snapshot ----

export async function takeSnapshot(db: D1Database): Promise<Snapshot> {
  const results = await db.batch(
    INSERT_ORDER.map((t) => db.prepare(`SELECT ${TABLE_COLUMNS[t].join(', ')} FROM ${t} ORDER BY rowid`)),
  );
  const tables = {} as Record<TableName, SnapshotRow[]>;
  INSERT_ORDER.forEach((t, i) => {
    tables[t] = (results[i].results ?? []) as SnapshotRow[];
  });
  return { format: SNAPSHOT_FORMAT, createdAt: Date.now(), tables };
}

// ---- chunking ----

/**
 * Split into chunks of at most CHUNK_CODE_UNITS + 1 UTF-16 code units, never splitting a
 * surrogate pair: a lone surrogate would not survive the UTF-8 round-trip through D1 TEXT
 * (it becomes U+FFFD) and would corrupt the JSON. Exported for tests.
 */
export function chunkString(s: string, size = CHUNK_CODE_UNITS): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < s.length; ) {
    let end = Math.min(i + size, s.length);
    const last = s.charCodeAt(end - 1);
    if (end < s.length && last >= 0xd800 && last <= 0xdbff) end++; // keep the pair together
    chunks.push(s.slice(i, end));
    i = end;
  }
  return chunks.length ? chunks : [''];
}

// ---- stored backups ----

export async function listBackups(db: D1Database): Promise<BackupMeta[]> {
  const rows = await db.prepare('SELECT id, name, kind, created_at, bytes FROM backups ORDER BY created_at DESC, id DESC').all<BackupMeta>();
  return rows.results;
}

export async function storeBackup(db: D1Database, name: string, kind: BackupKind, snap: Snapshot): Promise<BackupMeta> {
  const json = JSON.stringify(snap);
  const bytes = new TextEncoder().encode(json).length;
  const chunks = chunkString(json);
  const meta = await db
    .prepare('INSERT INTO backups (name, kind, created_at, bytes, chunk_count) VALUES (?, ?, ?, ?, ?) RETURNING id, name, kind, created_at, bytes')
    .bind(name, kind, Date.now(), bytes, chunks.length)
    .first<BackupMeta>();
  await db.batch(chunks.map((data, idx) => db.prepare('INSERT INTO backup_chunks (backup_id, idx, data) VALUES (?, ?, ?)').bind(meta!.id, idx, data)));
  // Safety backups are kept short: only the newest AUTO_KEEP of each auto kind survive.
  if (kind !== 'manual') await pruneAutoBackups(db, kind);
  return meta!;
}

async function pruneAutoBackups(db: D1Database, kind: BackupKind) {
  const stale = await db
    .prepare('SELECT id FROM backups WHERE kind = ? ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?')
    .bind(kind, AUTO_KEEP)
    .all<{ id: number }>();
  for (const row of stale.results) await deleteBackup(db, row.id);
}

export async function deleteBackup(db: D1Database, id: number) {
  await db.batch([
    db.prepare('DELETE FROM backup_chunks WHERE backup_id = ?').bind(id),
    db.prepare('DELETE FROM backups WHERE id = ?').bind(id),
  ]);
}

export async function totalBackupBytes(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COALESCE(SUM(bytes), 0) AS n FROM backups').first<{ n: number }>();
  return row?.n ?? 0;
}

/** Reassemble a stored backup's snapshot JSON (unvalidated — stored snapshots were validated on the way in). */
export async function loadBackupJson(db: D1Database, id: number): Promise<string | null> {
  const meta = await db.prepare('SELECT chunk_count FROM backups WHERE id = ?').bind(id).first<{ chunk_count: number }>();
  if (!meta) return null;
  const rows = await db.prepare('SELECT data FROM backup_chunks WHERE backup_id = ? ORDER BY idx').bind(id).all<{ data: string }>();
  if (rows.results.length !== meta.chunk_count) throw new Error('backup is corrupted (missing chunks)');
  return rows.results.map((r) => r.data).join('');
}

export async function loadBackup(db: D1Database, id: number): Promise<Snapshot | null> {
  const json = await loadBackupJson(db, id);
  if (json == null) return null;
  const snap: unknown = JSON.parse(json);
  validateSnapshot(snap);
  return snap;
}

// ---- validation ----

/**
 * Strict shape check for anything that will be restored — especially uploaded files.
 * Every row must contain only known columns with string/number/null values (integers
 * where an id/count is expected), because restore inlines them into SQL. Columns listed
 * in OPTIONAL_COLUMNS may be absent (older backups predate them; they restore as NULL).
 */
export function validateSnapshot(x: unknown): asserts x is Snapshot {
  if (typeof x !== 'object' || x === null) throw new Error('not a backup file');
  const s = x as Record<string, unknown>;
  if (s.format !== SNAPSHOT_FORMAT) throw new Error(`not a ${SNAPSHOT_FORMAT} backup file`);
  if (typeof s.tables !== 'object' || s.tables === null) throw new Error('backup has no tables');
  const tables = s.tables as Record<string, unknown>;
  const names = Object.keys(tables);
  for (const name of names) if (!(name in TABLE_COLUMNS)) throw new Error(`unknown table "${name}"`);
  for (const name of INSERT_ORDER) {
    const rows = tables[name];
    if (!Array.isArray(rows)) throw new Error(`table "${name}" is missing`);
    const cols = TABLE_COLUMNS[name];
    const optional = OPTIONAL_COLUMNS[name] ?? [];
    for (const row of rows) {
      if (typeof row !== 'object' || row === null || Array.isArray(row)) throw new Error(`bad row in "${name}"`);
      for (const key of Object.keys(row as object)) {
        if (!(cols as readonly string[]).includes(key)) throw new Error(`bad row shape in "${name}"`);
      }
      for (const col of cols) {
        if (!(col in (row as object))) {
          if (optional.includes(col)) continue; // older backup: restores as NULL
          throw new Error(`row in "${name}" is missing "${col}"`);
        }
        const v = (row as Record<string, unknown>)[col];
        if (v === null) continue;
        if (typeof v === 'string') continue;
        if (typeof v === 'number' && Number.isFinite(v)) {
          // ids, counts and flags must be integers; SQLite REALs never appear in this schema.
          if (!Number.isInteger(v)) throw new Error(`non-integer number in "${name}.${col}"`);
          continue;
        }
        throw new Error(`bad value type in "${name}.${col}"`);
      }
    }
  }
}

// ---- restore ----

/** Inline a validated snapshot value as a SQL literal. */
export function sqlLiteral(v: string | number | null): string {
  if (v === null) return 'NULL';
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) throw new Error('non-integer number in snapshot');
    return String(v);
  }
  return `'${v.replace(/'/g, "''")}'`;
}

/** Multi-row INSERT statements for one table, each kept under the SQL-text budget. Exported for tests. */
export function insertStatements(table: TableName, rows: SnapshotRow[]): string[] {
  if (rows.length === 0) return [];
  const cols = TABLE_COLUMNS[table];
  const head = `INSERT INTO ${table} (${cols.join(', ')}) VALUES `;
  const stmts: string[] = [];
  let values: string[] = [];
  let size = head.length;
  for (const row of rows) {
    const tuple = `(${cols.map((c) => sqlLiteral(row[c] ?? null)).join(', ')})`;
    if (values.length > 0 && size + tuple.length + 1 > STATEMENT_TEXT_BUDGET) {
      stmts.push(head + values.join(','));
      values = [];
      size = head.length;
    }
    values.push(tuple);
    size += tuple.length + 1;
  }
  stmts.push(head + values.join(','));
  return stmts;
}

/**
 * Replace all app-table contents with the snapshot, in one transaction. Sessions caught
 * mid-roll-off come back as 'open': live progress lives in the Durable Objects, which the
 * caller resets afterwards, so D1 and the DOs agree.
 */
export async function restoreSnapshot(db: D1Database, snap: Snapshot) {
  const sql: string[] = [
    // Belt and braces: ordering alone is FK-safe, but defer checks to commit anyway.
    'PRAGMA defer_foreign_keys = on',
    ...DELETE_ORDER.map((t) => `DELETE FROM ${t}`),
  ];
  for (const t of INSERT_ORDER) sql.push(...insertStatements(t, snap.tables[t]));
  sql.push("UPDATE sessions SET status = 'open' WHERE status IN ('staging', 'rolling')");
  await db.batch(sql.map((s) => db.prepare(s)));
}
