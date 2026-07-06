import type Database from "./db";

export type AgentCli = {
  id: string;
  label: string;
  command: string;
  args_template: string;
  resume_args_template: string;
  terminal_resume_template: string;
  enabled: number;
  is_builtin: number;
};

export type ByokProvider = {
  id: string;
  label: string;
  kind: string;
  base_url: string | null;
  default_model: string | null;
  enabled: number;
};

export async function listAgentClis(db: Database): Promise<AgentCli[]> {
  return db.select<AgentCli[]>("SELECT * FROM agent_clis ORDER BY is_builtin DESC, label ASC");
}

export async function saveAgentCli(db: Database, cli: Omit<AgentCli, "is_builtin">): Promise<void> {
  await db.execute(
    `INSERT INTO agent_clis (id, label, command, args_template, resume_args_template, terminal_resume_template, enabled, is_builtin)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 0)
     ON CONFLICT(id) DO UPDATE SET label = $2, command = $3, args_template = $4, resume_args_template = $5, terminal_resume_template = $6, enabled = $7`,
    [cli.id, cli.label, cli.command, cli.args_template, cli.resume_args_template, cli.terminal_resume_template, cli.enabled],
  );
}

export async function setAgentCliEnabled(db: Database, id: string, enabled: boolean): Promise<void> {
  await db.execute("UPDATE agent_clis SET enabled = $1 WHERE id = $2", [enabled ? 1 : 0, id]);
}

export async function deleteAgentCli(db: Database, id: string): Promise<void> {
  await db.execute("DELETE FROM agent_clis WHERE id = $1 AND is_builtin = 0", [id]);
}

export async function listByokProviders(db: Database): Promise<ByokProvider[]> {
  return db.select<ByokProvider[]>("SELECT * FROM byok_providers ORDER BY label ASC");
}

export async function saveByokProvider(db: Database, provider: ByokProvider): Promise<void> {
  await db.execute(
    `INSERT INTO byok_providers (id, label, kind, base_url, default_model, enabled)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT(id) DO UPDATE SET label = $2, kind = $3, base_url = $4, default_model = $5, enabled = $6`,
    [provider.id, provider.label, provider.kind, provider.base_url, provider.default_model, provider.enabled],
  );
}

export async function saveApiKey(provider: string, key: string): Promise<void> {
  await window.api.saveApiKey(provider, key);
}

export async function getApiKey(provider: string): Promise<string | null> {
  return window.api.getApiKey(provider);
}

export async function deleteApiKey(provider: string): Promise<void> {
  await window.api.deleteApiKey(provider);
}

/** Substitutes {prompt} and {resume_id} into a JSON-array argv template from an agent_clis row. */
export function buildAgentArgs(template: string, vars: { prompt: string; resumeId?: string }): string[] {
  const tokens = JSON.parse(template) as string[];
  return tokens.map((t) =>
    t.replace("{prompt}", vars.prompt).replace("{resume_id}", vars.resumeId ?? ""),
  );
}

/** A turn finishing isn't the same as the task being done — a mid-conversation reply
 * ("sure, want me to also update the tests?") shouldn't flip status to done. The agent is
 * asked to end its final message with this sentinel only once it believes the whole
 * request is satisfied; everything else just pauses, ready for another follow-up. */
export const COMPLETION_MARKER = "<<TASK_COMPLETE>>";

export function withCompletionInstruction(prompt: string): string {
  return `${prompt}\n\n(If — and only if — this fully completes what was asked with nothing further needed, end your final reply with the exact line ${COMPLETION_MARKER}. Otherwise omit it, even if you're pausing for input.)`;
}

export const COMPLETION_SYSTEM_PROMPT = `If — and only if — the user's request is now fully satisfied with nothing further needed, end your reply with the exact line ${COMPLETION_MARKER}. Otherwise omit it, even when pausing for the user's input.`;

export function extractCompletion(text: string): { complete: boolean; text: string } {
  const complete = text.includes(COMPLETION_MARKER);
  return { complete, text: text.split(COMPLETION_MARKER).join("").trim() };
}

const TOOL_ACTIVITY: Record<string, string> = {
  Bash: "Running a command…",
  Read: "Reading a file…",
  Write: "Writing a file…",
  Edit: "Editing a file…",
  Grep: "Searching the code…",
  Glob: "Looking for files…",
  Task: "Delegating a sub-task…",
  WebFetch: "Fetching a page…",
  WebSearch: "Searching the web…",
};

/** The CLI streams raw JSON-lines (stream-json) meant for machine consumption, not display —
 * this turns the most recent line into a short human status ("Reading a file…", "Thinking…")
 * instead of dumping the JSON itself in the UI. */
export function describeAgentActivity(lines: string[]): string {
  for (let i = lines.length - 1; i >= 0; i--) {
    let parsed: any;
    try {
      parsed = JSON.parse(lines[i]);
    } catch {
      // Our own diagnostics (spawn failed, binary missing) aren't JSON — surface them
      // directly instead of skipping past them to an older, now-stale status.
      if (lines[i].startsWith("[dispatch]")) return lines[i].replace(/^\[dispatch\]\s*/, "");
      continue;
    }
    if (parsed.type === "assistant") {
      const content: any[] = parsed.message?.content ?? [];
      const toolUse = content.find((c) => c.type === "tool_use");
      if (toolUse) return TOOL_ACTIVITY[toolUse.name] ?? `Using ${toolUse.name}…`;
      if (content.some((c) => c.type === "text")) return "Thinking…";
      return "Thinking…";
    }
    if (parsed.type === "user") return "Reviewing results…";
    if (parsed.type === "item.completed" || parsed.type === "item.started") return "Working…";
    if ((parsed.type === "system" && parsed.subtype === "init") || parsed.type === "thread.started") return "Starting agent…";
    return "Agent is thinking…";
  }
  return "Agent is thinking…";
}
