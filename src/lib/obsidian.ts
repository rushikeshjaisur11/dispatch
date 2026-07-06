import type Database from "./db";
import { getSetting } from "./settings";

export async function isObsidianVault(vaultPath: string): Promise<boolean> {
  if (!vaultPath.trim()) return false;
  return window.api.detectObsidianVault(vaultPath.trim());
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "task";
}

// SQLite's datetime('now') yields "YYYY-MM-DD HH:MM:SS" (UTC, no offset) — reshape to ISO before parsing.
function parseSqliteDatetime(s: string): number {
  return new Date(`${s.replace(" ", "T")}Z`).getTime();
}

function formatDuration(startedAt: string | null, endedAt: string | null): string {
  if (!startedAt || !endedAt) return "unknown";
  const seconds = Math.round((parseSqliteDatetime(endedAt) - parseSqliteDatetime(startedAt)) / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.round(seconds / 60)}m`;
}

/** Writes/appends a task's outcome as a markdown note into the configured Obsidian vault folder. No-ops if no vault is configured. */
export async function writeTaskNote(
  db: Database,
  task: { title: string; body: string; status: string; project_dir: string | null },
  agent: string,
  summary: string,
  startedAt: string | null,
  endedAt: string | null,
): Promise<void> {
  const vaultPath = await getSetting(db, "obsidian_vault_path");
  if (!vaultPath) return;
  const folder = (await getSetting(db, "obsidian_folder")) ?? "inbox";
  const date = new Date().toISOString().slice(0, 10);
  const filename = `${date}-${slugify(task.title)}.md`;
  const content = `---
status: ${task.status}
agent: ${agent}
duration: ${formatDuration(startedAt, endedAt)}
project: ${task.project_dir ?? ""}
source: dispatch
---

# ${task.title}

${task.body}

## Agent summary

${summary || "(no summary captured)"}
`;
  await window.api.writeVaultNote({ vaultPath, folder, filename, content });
}
