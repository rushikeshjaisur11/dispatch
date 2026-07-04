import type Database from "@tauri-apps/plugin-sql";

export async function getSetting(db: Database, key: string): Promise<string | null> {
  const rows = await db.select<{ value: string }[]>("SELECT value FROM settings WHERE key = $1", [key]);
  return rows[0]?.value ?? null;
}

export async function setSetting(db: Database, key: string, value: string): Promise<void> {
  await db.execute(
    "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2",
    [key, value],
  );
}

/** Stable per-install identifier, gates Run/Resume to the machine that owns a running task. */
export async function getMachineId(db: Database): Promise<string> {
  const existing = await getSetting(db, "machine_id");
  if (existing) return existing;
  const id = crypto.randomUUID();
  await setSetting(db, "machine_id", id);
  return id;
}
