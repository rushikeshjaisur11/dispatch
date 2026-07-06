const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

/** Ordered list of migration files; index+1 is the version applied via PRAGMA user_version. */
const MIGRATIONS = [
  "0001_init.sql",
  "0002_agent_runs.sql",
  "0003_settings.sql",
  "0004_note_group_updated_at.sql",
  "0005_group_nesting.sql",
  "0006_task_color.sql",
  "0007_agent_clis.sql",
  "0008_byok_providers.sql",
  "0009_messages.sql",
];

let db = null;

function openDatabase(userDataDir) {
  const dbPath = path.join(userDataDir, "agentpad.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  runMigrations();
  return db;
}

/** Applies only migrations newer than PRAGMA user_version, inside one transaction — replaces
 * tauri-plugin-sql's version ledger so re-running (e.g. 0009's ALTER TABLE) never re-applies. */
function runMigrations() {
  const currentVersion = db.pragma("user_version", { simple: true });
  if (currentVersion >= MIGRATIONS.length) return;
  const apply = db.transaction(() => {
    for (let i = currentVersion; i < MIGRATIONS.length; i++) {
      const sql = fs.readFileSync(path.join(__dirname, "migrations", MIGRATIONS[i]), "utf8");
      db.exec(sql);
    }
    db.pragma(`user_version = ${MIGRATIONS.length}`);
  });
  apply();
}

/** `$1/$2...` params are bound positionally from the caller; better-sqlite3 needs a named
 * object for `$N` placeholders (and this handles a placeholder like $2 being reused twice
 * in the same statement, which a positional `?` rewrite would miscount). */
function toNamedParams(params) {
  const obj = {};
  (params ?? []).forEach((v, i) => {
    obj[i + 1] = v;
  });
  return obj;
}

function dbSelect(sql, params) {
  return db.prepare(sql).all(toNamedParams(params));
}

function dbExecute(sql, params) {
  const info = db.prepare(sql).run(toNamedParams(params));
  return { rowsAffected: info.changes, lastInsertId: info.lastInsertRowid };
}

module.exports = { openDatabase, dbSelect, dbExecute };
