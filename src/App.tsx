import { useEffect, useRef, useState } from "react";
import Database from "@tauri-apps/plugin-sql";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { Session } from "@supabase/supabase-js";
import { getSupabase, initSupabase } from "./lib/supabase";
import { getMachineId, getSetting, setSetting } from "./lib/settings";
import { syncNow } from "./lib/sync";
import { pushTaskToCalendar, pullCalendarEvents, getGoogleCreds } from "./lib/googleCalendar";
import "./App.css";

type Task = {
  id: string;
  note_group_id: string;
  title: string;
  body: string;
  status: string;
  project_dir: string | null;
  machine_id: string | null;
  due_at: string | null;
  calendar_event_id: string | null;
};

type AgentEventLine =
  | { type: "system"; subtype: "init"; session_id: string }
  | { type: "result"; subtype: string; result?: string; session_id: string }
  | { type: "assistant"; message: { content: { type: string; text?: string }[] } }
  | { type: "thread.started"; thread_id: string }
  | { type: "turn.completed" | "turn.failed" }
  | { type: "item.completed"; item: { type: string; text?: string } };

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
  const runningAgent = useRef<Record<string, string>>({});
  const [machineId, setMachineId] = useState<string | null>(null);

  useEffect(() => {
    refresh();
    getMachineId(db).then(setMachineId);
    getGoogleCreds(db).then((creds) => {
      if (creds) pullCalendarEvents(db, groupId).then(refresh);
    });
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
      const sessionId =
        parsed.type === "system" && parsed.subtype === "init"
          ? parsed.session_id
          : parsed.type === "thread.started"
            ? parsed.thread_id
            : null;
      if (sessionId) {
        sessionIds.current[task_id] = sessionId;
        await db.execute(
          "INSERT INTO agent_runs (id, task_id, agent, session_id) VALUES ($1, $2, $3, $4)",
          [crypto.randomUUID(), task_id, runningAgent.current[task_id] ?? "claude", sessionId],
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
        const summary = parsed.type === "result" ? (parsed.result ?? "") : lastAssistantText.current[task_id] ?? "";
        await db.execute(
          "UPDATE tasks SET status = 'done', updated_at = datetime('now') WHERE id = $1",
          [task_id],
        );
        await db.execute(
          "UPDATE agent_runs SET end_reason = $1, summary = $2, ended_at = datetime('now') WHERE task_id = $3 AND session_id = $4",
          [endReason, summary, task_id, sessionIds.current[task_id] ?? null],
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
      "SELECT id, note_group_id, title, body, status, project_dir, machine_id, due_at, calendar_event_id FROM tasks WHERE note_group_id = $1 AND deleted_at IS NULL ORDER BY updated_at DESC",
      [groupId],
    );
    setTasks(rows);
  }

  async function runAgent(task: Task, agent: string, resumeSessionId?: string) {
    let projectDir = task.project_dir;
    if (!projectDir) {
      projectDir = window.prompt(`Project directory for ${agent} to work in:`) ?? "";
      if (!projectDir) return;
      await db.execute("UPDATE tasks SET project_dir = $1 WHERE id = $2", [projectDir, task.id]);
    }
    runningAgent.current[task.id] = agent;
    setLogs((prev) => ({ ...prev, [task.id]: [] }));
    await db.execute(
      "UPDATE tasks SET status = 'running', assignee = $1, machine_id = $2, updated_at = datetime('now') WHERE id = $3",
      [agent, machineId, task.id],
    );
    refresh();
    await invoke("run_agent", {
      taskId: task.id,
      agent,
      projectDir,
      prompt: task.body ? `${task.title}\n\n${task.body}` : task.title,
      resumeSessionId: resumeSessionId ?? null,
    });
  }

  async function pauseAgent(taskId: string) {
    await invoke("pause_agent", { taskId });
  }

  async function resumeAgent(task: Task) {
    const rows = await db.select<{ agent: string; session_id: string }[]>(
      "SELECT agent, session_id FROM agent_runs WHERE task_id = $1 AND session_id IS NOT NULL ORDER BY started_at DESC LIMIT 1",
      [task.id],
    );
    if (!rows[0]) return;
    await runAgent(task, rows[0].agent, rows[0].session_id);
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
              {t.machine_id && t.machine_id !== machineId ? (
                <span className="text-xs text-gray-400">on another machine</span>
              ) : t.status === "running" ? (
                <button className="text-xs px-2 py-1 bg-gray-200 rounded" onClick={() => pauseAgent(t.id)}>
                  Pause
                </button>
              ) : t.status === "paused" ? (
                <button className="text-xs px-2 py-1 bg-gray-200 rounded" onClick={() => resumeAgent(t)}>
                  Resume
                </button>
              ) : (
                <>
                  <button className="text-xs px-2 py-1 bg-gray-200 rounded" onClick={() => runAgent(t, "claude")}>
                    Run w/ Claude
                  </button>
                  <button className="text-xs px-2 py-1 bg-gray-200 rounded" onClick={() => runAgent(t, "codex")}>
                    Run w/ Codex
                  </button>
                </>
              )}
              <input
                type="datetime-local"
                className="text-xs border rounded px-1"
                value={t.due_at ? t.due_at.slice(0, 16) : ""}
                onChange={(e) => setDueDate(t, e.target.value)}
              />
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

function SettingsView() {
  const db = useDb();
  const [url, setUrl] = useState("");
  const [anonKey, setAnonKey] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [linkSent, setLinkSent] = useState(false);
  const [status, setStatus] = useState("");
  const [googleClientId, setGoogleClientId] = useState("");
  const [googleClientSecret, setGoogleClientSecret] = useState("");
  const [googleEmail, setGoogleEmail] = useState<string | null>(null);
  const [googleStatus, setGoogleStatus] = useState("");

  useEffect(() => {
    if (!db) return;
    (async () => {
      const savedUrl = await getSetting(db, "supabase_url");
      const savedKey = await getSetting(db, "supabase_anon_key");
      if (savedUrl && savedKey) {
        setUrl(savedUrl);
        setAnonKey(savedKey);
        const sb = initSupabase(savedUrl, savedKey);
        const { data } = await sb.auth.getSession();
        setSession(data.session);
      }
      const gClientId = await getSetting(db, "google_client_id");
      const gClientSecret = await getSetting(db, "google_client_secret");
      if (gClientId) setGoogleClientId(gClientId);
      if (gClientSecret) setGoogleClientSecret(gClientSecret);
      const signedIn = await invoke<boolean>("google_auth_status");
      if (signedIn) setGoogleEmail(await getSetting(db, "google_email"));
    })();
  }, [db]);

  useEffect(() => {
    const un = listen<{ success: boolean; email?: string; error?: string }>("google-auth-result", async (e) => {
      if (e.payload.success && e.payload.email) {
        setGoogleEmail(e.payload.email);
        setGoogleStatus("Connected.");
        if (db) await setSetting(db, "google_email", e.payload.email);
      } else {
        setGoogleStatus(e.payload.error ?? "Google sign-in failed.");
      }
    });
    return () => {
      un.then((f) => f());
    };
  }, [db]);

  useEffect(() => {
    const un = listen<{ code?: string }>("email-auth-redirect", async (e) => {
      const sb = getSupabase();
      if (!sb) return;
      if (!e.payload.code) {
        setStatus("Sign-in link didn't include a code — check the Supabase redirect URL allow-list.");
        return;
      }
      const { data, error } = await sb.auth.exchangeCodeForSession(e.payload.code);
      setStatus(error ? error.message : "Signed in.");
      if (data.session) setSession(data.session);
    });
    return () => {
      un.then((f) => f());
    };
  }, [db]);

  async function saveGoogleCreds() {
    if (!db || !googleClientId.trim() || !googleClientSecret.trim()) return;
    await setSetting(db, "google_client_id", googleClientId.trim());
    await setSetting(db, "google_client_secret", googleClientSecret.trim());
    setGoogleStatus("Saved. Click Connect to sign in.");
  }

  async function connectGoogle() {
    setGoogleStatus("Opening browser for Google sign-in...");
    await invoke("google_auth_start", { clientId: googleClientId.trim(), clientSecret: googleClientSecret.trim() });
  }

  async function disconnectGoogle() {
    await invoke("google_auth_sign_out");
    setGoogleEmail(null);
    setGoogleStatus("Disconnected.");
  }

  async function saveConnection() {
    if (!db || !url.trim() || !anonKey.trim()) return;
    await setSetting(db, "supabase_url", url.trim());
    await setSetting(db, "supabase_anon_key", anonKey.trim());
    const sb = initSupabase(url.trim(), anonKey.trim());
    const { data } = await sb.auth.getSession();
    setSession(data.session);
    setStatus("Connected.");
  }

  async function sendMagicLink() {
    const sb = getSupabase();
    if (!sb || !email.trim()) return;
    const port = await invoke<number>("start_local_redirect_listener");
    const { error } = await sb.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true, emailRedirectTo: `http://127.0.0.1:${port}` },
    });
    setStatus(error ? error.message : "Link sent — check your email and click it.");
    if (!error) setLinkSent(true);
  }

  async function signOut() {
    const sb = getSupabase();
    if (!sb) return;
    await sb.auth.signOut();
    setSession(null);
  }

  async function doSync() {
    if (!db || !session) return;
    setStatus("Syncing...");
    await syncNow(db, session.user.id);
    setStatus("Synced.");
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <section className="space-y-2">
        <h2 className="font-medium">Supabase connection</h2>
        <input
          className="w-full border rounded px-3 py-2"
          placeholder="Project URL (https://xxxx.supabase.co)"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <input
          className="w-full border rounded px-3 py-2"
          placeholder="anon public key"
          value={anonKey}
          onChange={(e) => setAnonKey(e.target.value)}
        />
        <button className="px-4 py-2 bg-black text-white rounded" onClick={saveConnection}>
          Save connection
        </button>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Account</h2>
        {session ? (
          <div className="space-y-2">
            <p className="text-sm text-gray-600">Signed in as {session.user.email}</p>
            <button className="px-4 py-2 bg-gray-200 rounded" onClick={doSync}>
              Sync now
            </button>
            <button className="px-4 py-2 bg-gray-200 rounded ml-2" onClick={signOut}>
              Sign out
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <input
              className="w-full border rounded px-3 py-2"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button className="px-4 py-2 bg-black text-white rounded" onClick={sendMagicLink}>
              Send sign-in link
            </button>
            {linkSent && <p className="text-sm text-gray-500">Click the link in your email — this window will pick it up automatically.</p>}
          </div>
        )}
        {status && <p className="text-sm text-gray-500">{status}</p>}
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Google Calendar</h2>
        <input
          className="w-full border rounded px-3 py-2"
          placeholder="Google OAuth Client ID"
          value={googleClientId}
          onChange={(e) => setGoogleClientId(e.target.value)}
        />
        <input
          className="w-full border rounded px-3 py-2"
          placeholder="Google OAuth Client Secret"
          value={googleClientSecret}
          onChange={(e) => setGoogleClientSecret(e.target.value)}
        />
        <button className="px-4 py-2 bg-black text-white rounded" onClick={saveGoogleCreds}>
          Save
        </button>
        {googleEmail ? (
          <div className="space-y-2">
            <p className="text-sm text-gray-600">Connected as {googleEmail}</p>
            <button className="px-4 py-2 bg-gray-200 rounded" onClick={disconnectGoogle}>
              Disconnect
            </button>
          </div>
        ) : (
          <button className="px-4 py-2 bg-gray-200 rounded" onClick={connectGoogle}>
            Connect Google Calendar
          </button>
        )}
        {googleStatus && <p className="text-sm text-gray-500">{googleStatus}</p>}
      </section>
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
  const settings = params.get("settings");

  if (capture) return <CaptureBar />;
  if (settings) return <SettingsView />;
  if (sticky) return <StickyNote groupId={sticky} />;
  return <Board />;
}

export default App;
