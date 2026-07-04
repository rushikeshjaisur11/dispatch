import type Database from "@tauri-apps/plugin-sql";
import { getSupabase } from "./supabase";
import { getSetting, setSetting } from "./settings";

const EPOCH = "1970-01-01T00:00:00Z";

// ponytail: watermark-per-table sync, not full per-row conflict resolution or a live
// Realtime subscription. Good enough for one user across a couple of machines; upgrade
// to Realtime + per-row last-write-wins if concurrent edits on the same row start colliding.
const TABLES: { name: string; timeCol: string }[] = [
  { name: "note_groups", timeCol: "updated_at" },
  { name: "tasks", timeCol: "updated_at" },
  { name: "agent_runs", timeCol: "started_at" },
];

export async function pushChanges(db: Database, userId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  for (const { name, timeCol } of TABLES) {
    const watermarkKey = `push_watermark_${name}`;
    const watermark = (await getSetting(db, watermarkKey)) ?? EPOCH;
    const rows = await db.select<Record<string, unknown>[]>(
      `SELECT * FROM ${name} WHERE ${timeCol} > $1 ORDER BY ${timeCol} ASC`,
      [watermark],
    );
    if (rows.length === 0) continue;
    const withUser = rows.map((r) => ({ ...r, user_id: userId }));
    const { error } = await sb.from(name).upsert(withUser, { onConflict: "id" });
    if (!error) {
      await setSetting(db, watermarkKey, rows[rows.length - 1][timeCol] as string);
    }
  }
}

export async function pullChanges(db: Database, userId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  for (const { name, timeCol } of TABLES) {
    const watermarkKey = `pull_watermark_${name}`;
    const watermark = (await getSetting(db, watermarkKey)) ?? EPOCH;
    const { data, error } = await sb
      .from(name)
      .select("*")
      .eq("user_id", userId)
      .gt(timeCol, watermark)
      .order(timeCol, { ascending: true });
    if (error || !data || data.length === 0) continue;
    for (const row of data) {
      const cols = Object.keys(row).filter((k) => k !== "user_id");
      const values = cols.map((c) => row[c]);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
      const updates = cols
        .filter((c) => c !== "id")
        .map((c) => `${c} = excluded.${c}`)
        .join(", ");
      await db.execute(
        `INSERT INTO ${name} (${cols.join(", ")}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updates}`,
        values,
      );
    }
    await setSetting(db, watermarkKey, data[data.length - 1][timeCol] as string);
  }
}

export async function syncNow(db: Database, userId: string): Promise<void> {
  await pushChanges(db, userId);
  await pullChanges(db, userId);
}
