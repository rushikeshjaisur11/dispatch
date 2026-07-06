import { useCallback, useEffect, useState } from "react";
import type Database from "../lib/db";
import { listAgentClis } from "../lib/agentIntegrations";

export type Session = {
  id: string;
  task_id: string;
  task_title: string;
  agent: string;
  session_id: string | null;
  run_kind: string;
  end_reason: string | null;
  summary: string | null;
  started_at: string;
  ended_at: string | null;
  project_dir: string | null;
};

/** Builds the human terminal-resume command for a CLI session — shared by the global
 * Sessions list and the per-note agent panel, so "open in terminal" behaves identically
 * from either place. */
export async function buildAgentResumeCommand(db: Database, agent: string, sessionId: string): Promise<string | undefined> {
  const clis = await listAgentClis(db);
  const cli = clis.find((c) => c.id === agent);
  if (!cli) return;
  return `${cli.command} ${cli.terminal_resume_template.replace("{resume_id}", sessionId)}`.trim();
}

/** Launches a real terminal window running the resume command, in the given project
 * directory, instead of making the user paste a copied command themselves. */
export async function openAgentInTerminal(db: Database, agent: string, sessionId: string, projectDir: string | null): Promise<void> {
  const command = await buildAgentResumeCommand(db, agent, sessionId);
  if (!command) return;
  await window.api.openTerminal(command, projectDir);
}

export function useSessions(db: Database | null) {
  const [sessions, setSessions] = useState<Session[]>([]);

  const refresh = useCallback(async () => {
    if (!db) return;
    const rows = await db.select<Session[]>(
      `SELECT agent_runs.id, agent_runs.task_id, tasks.title AS task_title, agent_runs.agent,
              agent_runs.session_id, agent_runs.run_kind, agent_runs.end_reason, agent_runs.summary,
              agent_runs.started_at, agent_runs.ended_at, tasks.project_dir
       FROM agent_runs
       JOIN tasks ON tasks.id = agent_runs.task_id
       ORDER BY agent_runs.started_at DESC`,
    );
    setSessions(rows);
  }, [db]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /** Builds the human terminal-resume command for a CLI session and copies it to the clipboard. */
  async function copyTerminalCommand(session: Session) {
    if (!db || session.run_kind !== "cli" || !session.session_id) return;
    const command = await buildAgentResumeCommand(db, session.agent, session.session_id);
    if (!command) return;
    await navigator.clipboard.writeText(command);
    return command;
  }

  async function openInTerminal(session: Session) {
    if (!db || session.run_kind !== "cli" || !session.session_id) return;
    await openAgentInTerminal(db, session.agent, session.session_id, session.project_dir);
  }

  return { sessions, refresh, copyTerminalCommand, openInTerminal };
}
