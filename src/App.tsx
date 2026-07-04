import { useEffect, useRef, useState } from "react";
import Database from "@tauri-apps/plugin-sql";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

type Task = {
  id: string;
  note_group_id: string;
  title: string;
  body: string;
  status: string;
  project_dir: string | null;
};

type AgentEventLine =
  | { type: "system"; subtype: "init"; session_id: string }
  | { type: "result"; subtype: string; result?: string; session_id: string }
  | { type: "assistant"; message: { content: { type: string; text?: string }[] } };

const DEFAULT_GROUP_ID = "default";

function useDb() {
  const [db, setDb] = useState<Database | null>(null);
  useEffect(() => {
    Database.load("sqlite:agentpad.db").then(async (conn) => {
      await conn.execute(
        "INSERT OR IGNORE INTO note_groups (id, title) VALUES ($1, $2)",
        [DEFAULT_GROUP_ID, "Inbox"],
      );
      setDb(conn);
    });
  }, []);
  return db;
}

function TaskList({ db, groupId }: { db: Database; groupId: string }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [logs, setLogs] = useState<Record<string, string[]>>({});
  const sessionIds = useRef<Record<string, string>>({});
  const lastAssistantText = useRef<Record<string, string>>({});

  useEffect(() => {
    refresh();
  }, [db, groupId]);

  useEffect(() => {
    const unlistenEvent = listen<{ task_id: string; line: string }>("agent-event", async (e) => {
      const { task_id, line } = e.payload;
      setLogs((prev) => ({ ...prev, [task_id]: [...(prev[task_id] ?? []), line] }));
      let parsed: AgentEventLine;
      try {
        parsed = JSON.parse(line);
      } catch {
        return;
      }
      if (parsed.type === "system" && parsed.subtype === "init") {
        sessionIds.current[task_id] = parsed.session_id;
        await db.execute(
          "INSERT INTO agent_runs (id, task_id, agent, session_id) VALUES ($1, $2, 'claude', $3)",
          [crypto.randomUUID(), task_id, parsed.session_id],
        );
      } else if (parsed.type === "assistant") {
        const text = parsed.message.content.find((c) => c.type === "text")?.text;
        if (text) lastAssistantText.current[task_id] = text;
      } else if (parsed.type === "result") {
        await db.execute(
          "UPDATE tasks SET status = 'done', updated_at = datetime('now') WHERE id = $1",
          [task_id],
        );
        await db.execute(
          "UPDATE agent_runs SET end_reason = 'success', summary = $1, ended_at = datetime('now') WHERE task_id = $2 AND session_id = $3",
          [parsed.result ?? "", task_id, sessionIds.current[task_id] ?? null],
        );
        refresh();
      }
    });
    const unlistenExit = listen<{ task_id: string }>("agent-exit", async (e) => {
      const { task_id } = e.payload;
      const task = tasks.find((t) => t.id === task_id);
      if (task && task.status === "running") {
        await db.execute(
          "UPDATE tasks SET status = 'paused', updated_at = datetime('now') WHERE id = $1",
          [task_id],
        );
        await db.execute(
          "UPDATE agent_runs SET end_reason = 'stopped', summary = $1, ended_at = datetime('now') WHERE task_id = $2 AND session_id = $3",
          [lastAssistantText.current[task_id] ?? "", task_id, sessionIds.current[task_id] ?? null],
        );
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
      "SELECT id, note_group_id, title, body, status, project_dir FROM tasks WHERE note_group_id = $1 AND deleted_at IS NULL ORDER BY updated_at DESC",
      [groupId],
    );
    setTasks(rows);
  }

  async function runAgent(task: Task, resumeSessionId?: string) {
    let projectDir = task.project_dir;
    if (!projectDir) {
      projectDir = window.prompt("Project directory for Claude to work in:") ?? "";
      if (!projectDir) return;
      await db.execute("UPDATE tasks SET project_dir = $1 WHERE id = $2", [projectDir, task.id]);
    }
    setLogs((prev) => ({ ...prev, [task.id]: [] }));
    await db.execute(
      "UPDATE tasks SET status = 'running', updated_at = datetime('now') WHERE id = $1",
      [task.id],
    );
    refresh();
    await invoke("run_agent", {
      taskId: task.id,
      projectDir,
      prompt: task.body ? `${task.title}\n\n${task.body}` : task.title,
      resumeSessionId: resumeSessionId ?? null,
    });
  }

  async function pauseAgent(taskId: string) {
    await invoke("pause_agent", { taskId });
  }

  async function resumeAgent(task: Task) {
    const rows = await db.select<{ session_id: string }[]>(
      "SELECT session_id FROM agent_runs WHERE task_id = $1 AND session_id IS NOT NULL ORDER BY started_at DESC LIMIT 1",
      [task.id],
    );
    await runAgent(task, rows[0]?.session_id);
  }

  async function addTask() {
    if (!title.trim()) return;
    const id = crypto.randomUUID();
    await db.execute(
      "INSERT INTO tasks (id, note_group_id, title) VALUES ($1, $2, $3)",
      [id, groupId, title.trim()],
    );
    setTitle("");
    refresh();
  }

  async function toggleDone(task: Task) {
    const next = task.status === "done" ? "todo" : "done";
    await db.execute(
      "UPDATE tasks SET status = $1, updated_at = datetime('now') WHERE id = $2",
      [next, task.id],
    );
    refresh();
  }

  return (
    <>
      <div className="flex gap-2 mb-4">
        <input
          className="flex-1 border rounded px-3 py-2"
          placeholder="New task..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addTask()}
        />
        <button className="px-4 py-2 bg-black text-white rounded" onClick={addTask}>
          Add
        </button>
      </div>
      <ul className="space-y-2">
        {tasks.map((t) => (
          <li key={t.id} className="bg-white rounded px-3 py-2 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="cursor-pointer" onClick={() => toggleDone(t)}>
                {t.status === "done" ? "✓" : t.status === "running" ? "●" : t.status === "paused" ? "◐" : "○"}
              </span>
              <span
                className={`flex-1 cursor-pointer ${t.status === "done" ? "line-through text-gray-400" : ""}`}
                onClick={() => toggleDone(t)}
              >
                {t.title}
              </span>
              {t.status === "running" ? (
                <button className="text-xs px-2 py-1 bg-gray-200 rounded" onClick={() => pauseAgent(t.id)}>
                  Pause
                </button>
              ) : t.status === "paused" ? (
                <button className="text-xs px-2 py-1 bg-gray-200 rounded" onClick={() => resumeAgent(t)}>
                  Resume
                </button>
              ) : (
                <button className="text-xs px-2 py-1 bg-gray-200 rounded" onClick={() => runAgent(t)}>
                  Run w/ Claude
                </button>
              )}
            </div>
            {logs[t.id] && logs[t.id].length > 0 && (
              <pre className="mt-1 text-[10px] text-gray-500 max-h-24 overflow-auto whitespace-pre-wrap">
                {logs[t.id].slice(-5).join("\n")}
              </pre>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function StickyNote({ groupId }: { groupId: string }) {
  const db = useDb();
  return (
    <main className="min-h-screen bg-yellow-100 flex flex-col">
      <div data-tauri-drag-region className="h-8 bg-yellow-200 shrink-0" />
      <div className="p-4 overflow-auto flex-1">
        {db && <TaskList db={db} groupId={groupId} />}
      </div>
    </main>
  );
}

function CaptureBar() {
  const db = useDb();
  const [title, setTitle] = useState("");

  async function submit() {
    if (!db || !title.trim()) return;
    await db.execute(
      "INSERT OR IGNORE INTO note_groups (id, title) VALUES ($1, $2)",
      [DEFAULT_GROUP_ID, "Inbox"],
    );
    const id = crypto.randomUUID();
    await db.execute(
      "INSERT INTO tasks (id, note_group_id, title) VALUES ($1, $2, $3)",
      [id, DEFAULT_GROUP_ID, title.trim()],
    );
    await getCurrentWindow().close();
  }

  return (
    <main className="min-h-screen bg-white flex items-center">
      <div data-tauri-drag-region className="w-2 h-full" />
      <input
        autoFocus
        className="flex-1 px-3 py-3 outline-none"
        placeholder="Quick capture a task, press Enter..."
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") getCurrentWindow().close();
        }}
      />
    </main>
  );
}

function Board() {
  const db = useDb();
  return (
    <main className="min-h-screen bg-yellow-50 p-6">
      <h1 className="text-2xl font-semibold mb-4">AgentPad — Inbox</h1>
      {db && <TaskList db={db} groupId={DEFAULT_GROUP_ID} />}
    </main>
  );
}

function App() {
  const params = new URLSearchParams(window.location.search);
  const sticky = params.get("sticky");
  const capture = params.get("capture");

  if (capture) return <CaptureBar />;
  if (sticky) return <StickyNote groupId={sticky} />;
  return <Board />;
}

export default App;
