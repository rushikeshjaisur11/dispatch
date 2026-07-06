import { useEffect, useRef, useState } from "react";
import type Database from "../lib/db";
import { listen } from "../lib/event";
import { getMachineId } from "../lib/settings";
import { pullCalendarEvents, getGoogleCreds, pushTaskToCalendar } from "../lib/googleCalendar";
import { writeTaskNote } from "../lib/obsidian";
import { listAgentClis, buildAgentArgs, withCompletionInstruction, extractCompletion, type AgentCli } from "../lib/agentIntegrations";

export type Task = {
  id: string;
  note_group_id: string;
  title: string;
  body: string;
  status: string;
  project_dir: string | null;
  machine_id: string | null;
  due_at: string | null;
  calendar_event_id: string | null;
  color: string | null;
};

type AgentEventLine =
  | { type: "system"; subtype: "init"; session_id: string }
  | { type: "result"; subtype: string; result?: string; session_id: string }
  | { type: "assistant"; message: { content: { type: string; text?: string }[] } }
  | { type: "thread.started"; thread_id: string }
  | { type: "turn.completed" | "turn.failed" }
  | { type: "item.completed"; item: { type: string; text?: string } };

export function useTasks(db: Database, groupId: string) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [logs, setLogs] = useState<Record<string, string[]>>({});
  const [clis, setClis] = useState<AgentCli[]>([]);
  const sessionIds = useRef<Record<string, string>>({});
  const lastAssistantText = useRef<Record<string, string>>({});
  const runningCli = useRef<Record<string, AgentCli>>({});
  const [machineId, setMachineId] = useState<string | null>(null);

  useEffect(() => {
    refresh();
    getMachineId(db).then(setMachineId);
    listAgentClis(db).then(setClis);
    // Credentials existing (now possibly the embedded app default) doesn't mean the user
    // has actually signed in yet — gate on auth status too, or this throws every launch
    // until someone connects Google Calendar.
    Promise.all([getGoogleCreds(db), window.api.googleAuthStatus()]).then(([creds, signedIn]) => {
      if (creds && signedIn) pullCalendarEvents(db, groupId).then(refresh);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, groupId]);

  useEffect(() => {
    async function recordAssistantMessage(taskId: string, content: string, runId: string | null) {
      if (!content) return;
      await db.execute(
        "INSERT INTO messages (id, task_id, run_id, role, content) VALUES ($1, $2, $3, 'assistant', $4)",
        [crypto.randomUUID(), taskId, runId, content],
      );
    }

    const unlistenEvent = listen<{ task_id: string; line: string }>("agent-event", async (e) => {
      const { task_id, line } = e.payload;
      setLogs((prev) => ({ ...prev, [task_id]: [...(prev[task_id] ?? []), line] }));
      let parsed: AgentEventLine;
      try {
        parsed = JSON.parse(line);
      } catch {
        // Not a JSON stream line — agentRunner.cjs's own diagnostics (spawn failed, binary
        // missing, bad cwd) look like this. Without capturing it, agent-exit's summary falls
        // back to an empty string and the failure is invisible — a follow-up on a note whose
        // project_dir no longer exists would silently appear to do nothing.
        if (line.startsWith("[dispatch]")) lastAssistantText.current[task_id] = line.replace(/^\[dispatch\]\s*/, "");
        return;
      }
      const sessionId =
        parsed.type === "system" && parsed.subtype === "init"
          ? parsed.session_id
          : parsed.type === "thread.started"
            ? parsed.thread_id
            : null;
      if (sessionId) {
        sessionIds.current[task_id] = sessionId;
        await db.execute(
          "INSERT INTO agent_runs (id, task_id, agent, session_id, run_kind) VALUES ($1, $2, $3, $4, 'cli')",
          [crypto.randomUUID(), task_id, runningCli.current[task_id]?.id ?? "claude", sessionId],
        );
        return;
      }
      if (parsed.type === "assistant") {
        const text = parsed.message.content.find((c) => c.type === "text")?.text;
        if (text) lastAssistantText.current[task_id] = text;
        return;
      }
      if (parsed.type === "item.completed" && parsed.item.type === "agent_message") {
        if (parsed.item.text) lastAssistantText.current[task_id] = parsed.item.text;
        return;
      }
      const endReason =
        parsed.type === "result" ? "success" : parsed.type === "turn.completed" ? "success" : parsed.type === "turn.failed" ? "error" : null;
      if (endReason) {
        const rawSummary = parsed.type === "result" ? (parsed.result ?? "") : lastAssistantText.current[task_id] ?? "";
        // A turn ending isn't the same as the request being done — only the agent's own
        // completion signal (see withCompletionInstruction) flips status to 'done'; anything
        // else pauses, so the conversation can keep going via a follow-up.
        const { complete, text: summary } = extractCompletion(rawSummary);
        const nextStatus = endReason === "error" ? "paused" : complete ? "done" : "paused";
        const runRows = await db.select<{ id: string; started_at: string }[]>(
          "SELECT id, started_at FROM agent_runs WHERE task_id = $1 AND session_id = $2",
          [task_id, sessionIds.current[task_id] ?? null],
        );
        await db.execute("UPDATE tasks SET status = $1, updated_at = datetime('now') WHERE id = $2", [nextStatus, task_id]);
        const endedAt = new Date().toISOString().replace("T", " ").slice(0, 19);
        await db.execute(
          "UPDATE agent_runs SET end_reason = $1, summary = $2, ended_at = datetime('now') WHERE task_id = $3 AND session_id = $4",
          [endReason, summary, task_id, sessionIds.current[task_id] ?? null],
        );
        await recordAssistantMessage(task_id, summary, runRows[0]?.id ?? null);
        const task = tasks.find((t) => t.id === task_id);
        if (task && nextStatus === "done") {
          await writeTaskNote(db, { ...task, status: "done" }, runningCli.current[task_id]?.id ?? "claude", summary, runRows[0]?.started_at ?? null, endedAt);
        }
        refresh();
      }
    });
    const unlistenExit = listen<{ task_id: string }>("agent-exit", async (e) => {
      const { task_id } = e.payload;
      const task = tasks.find((t) => t.id === task_id);
      if (task && task.status === "running") {
        const runRows = await db.select<{ id: string; started_at: string }[]>(
          "SELECT id, started_at FROM agent_runs WHERE task_id = $1 AND session_id = $2",
          [task_id, sessionIds.current[task_id] ?? null],
        );
        await db.execute("UPDATE tasks SET status = 'paused', updated_at = datetime('now') WHERE id = $1", [task_id]);
        const summary = lastAssistantText.current[task_id] ?? "";
        const endedAt = new Date().toISOString().replace("T", " ").slice(0, 19);
        await db.execute(
          "UPDATE agent_runs SET end_reason = 'stopped', summary = $1, ended_at = datetime('now') WHERE task_id = $2 AND session_id = $3",
          [summary, task_id, sessionIds.current[task_id] ?? null],
        );
        await recordAssistantMessage(task_id, summary, runRows[0]?.id ?? null);
        await writeTaskNote(db, { ...task, status: "paused" }, runningCli.current[task_id]?.id ?? "claude", summary, runRows[0]?.started_at ?? null, endedAt);
        refresh();
      }
    });
    return () => {
      unlistenEvent.then((f) => f());
      unlistenExit.then((f) => f());
    };
  }, [db, tasks]);

  async function refresh() {
    const rows = await db.select<Task[]>(
      "SELECT id, note_group_id, title, body, status, project_dir, machine_id, due_at, calendar_event_id, color FROM tasks WHERE note_group_id = $1 AND deleted_at IS NULL ORDER BY updated_at DESC",
      [groupId],
    );
    setTasks(rows);
  }

  /** `promptOverride` lets the AgentPanel send a follow-up turn without re-sending the task title/body. */
  /** Caller (AgentPanel) must ensure `task.project_dir` is set first — via `setProjectDir` —
   * since `window.prompt` doesn't work in Electron's renderer (throws instead of showing a
   * dialog), unlike the browser this was originally written against. */
  async function runAgent(task: Task, cli: AgentCli, resumeSessionId?: string, promptOverride?: string) {
    const projectDir = task.project_dir;
    if (!projectDir) return;
    const basePrompt = promptOverride ?? (task.body ? `${task.title}\n\n${task.body}` : task.title);
    const prompt = withCompletionInstruction(basePrompt);
    runningCli.current[task.id] = cli;
    setLogs((prev) => ({ ...prev, [task.id]: [] }));
    await db.execute(
      "UPDATE tasks SET status = 'running', assignee = $1, machine_id = $2, updated_at = datetime('now') WHERE id = $3",
      [cli.id, machineId, task.id],
    );
    await db.execute("INSERT INTO messages (id, task_id, role, content) VALUES ($1, $2, 'user', $3)", [crypto.randomUUID(), task.id, basePrompt]);
    refresh();
    const args = buildAgentArgs(resumeSessionId ? cli.resume_args_template : cli.args_template, { prompt, resumeId: resumeSessionId });
    await window.api.runAgent({ taskId: task.id, command: cli.command, args, projectDir });
  }

  async function pauseAgent(taskId: string) {
    await window.api.pauseAgent(taskId);
  }

  /** Older notes may have no resumable CLI session (never ran, or the run never reached
   * "init" so no session_id was recorded) — that used to make follow-ups silently no-op.
   * Falling back to the last-used (or first enabled) CLI and starting a fresh run instead
   * of a resume means a follow-up on any note always spawns an agent. */
  async function resumeAgent(task: Task, promptOverride?: string) {
    const rows = await db.select<{ agent: string; session_id: string }[]>(
      "SELECT agent, session_id FROM agent_runs WHERE task_id = $1 AND run_kind = 'cli' ORDER BY started_at DESC LIMIT 1",
      [task.id],
    );
    const cli = clis.find((c) => c.id === rows[0]?.agent) ?? clis.find((c) => c.enabled);
    if (!cli) return;
    await runAgent(task, cli, rows[0]?.session_id, promptOverride);
  }

  async function addTask(title: string, body?: string) {
    if (!title.trim()) return;
    const id = crypto.randomUUID();
    await db.execute("INSERT INTO tasks (id, note_group_id, title, body) VALUES ($1, $2, $3, $4)", [id, groupId, title.trim(), body?.trim() ?? ""]);
    refresh();
  }

  async function setDueDate(task: Task, dueAt: string) {
    const iso = dueAt ? new Date(dueAt).toISOString() : null;
    await db.execute("UPDATE tasks SET due_at = $1, updated_at = datetime('now') WHERE id = $2", [iso, task.id]);
    refresh();
    if (iso) {
      try {
        await pushTaskToCalendar(db, { ...task, due_at: iso });
      } catch (err) {
        // ponytail: alert() as a quick diagnostic surface; replace with inline row status if this becomes routine.
        alert(`Calendar push failed: ${err}`);
      }
    }
  }

  async function toggleDone(task: Task) {
    const next = task.status === "done" ? "todo" : "done";
    await db.execute("UPDATE tasks SET status = $1, updated_at = datetime('now') WHERE id = $2", [next, task.id]);
    refresh();
  }

  async function deleteTask(taskId: string) {
    await db.execute("UPDATE tasks SET deleted_at = datetime('now') WHERE id = $1", [taskId]);
    refresh();
  }

  async function setProjectDir(taskId: string, projectDir: string) {
    await db.execute("UPDATE tasks SET project_dir = $1 WHERE id = $2", [projectDir, taskId]);
    refresh();
  }

  async function updateTaskDetails(taskId: string, title: string, body: string) {
    await db.execute("UPDATE tasks SET title = $1, body = $2, updated_at = datetime('now') WHERE id = $3", [title.trim(), body, taskId]);
    refresh();
  }

  return {
    tasks,
    logs,
    machineId,
    clis,
    addTask,
    runAgent,
    pauseAgent,
    resumeAgent,
    setDueDate,
    toggleDone,
    deleteTask,
    setProjectDir,
    updateTaskDetails,
  };
}
