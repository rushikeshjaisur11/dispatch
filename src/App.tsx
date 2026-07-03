import { useEffect, useState } from "react";
import Database from "@tauri-apps/plugin-sql";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./App.css";

type Task = {
  id: string;
  note_group_id: string;
  title: string;
  status: string;
};

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

  useEffect(() => {
    refresh();
  }, [db, groupId]);

  async function refresh() {
    const rows = await db.select<Task[]>(
      "SELECT id, note_group_id, title, status FROM tasks WHERE note_group_id = $1 AND deleted_at IS NULL ORDER BY updated_at DESC",
      [groupId],
    );
    setTasks(rows);
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
          <li
            key={t.id}
            className="flex items-center gap-2 bg-white rounded px-3 py-2 shadow-sm cursor-pointer"
            onClick={() => toggleDone(t)}
          >
            <span>{t.status === "done" ? "✓" : "○"}</span>
            <span className={t.status === "done" ? "line-through text-gray-400" : ""}>
              {t.title}
            </span>
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
