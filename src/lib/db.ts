/** Matches the Tauri SQL-plugin's `Database` interface shape so hooks written against it
 * port with just this import swapped in. Backed by the `window.api.db` IPC bridge (see
 * preload.js / electron/database.js) instead of an async plugin load — the bridge is ready
 * before first render, which also fixes the old `{} as Database` race on cold start. */
export default interface Database {
  select<T>(sql: string, params?: unknown[]): Promise<T>;
  execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number; lastInsertId: number | bigint }>;
}

export const db: Database = {
  select: (sql, params) => window.api.db.select(sql, params),
  execute: (sql, params) => window.api.db.execute(sql, params),
};
