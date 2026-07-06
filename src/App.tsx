import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { springEnter, pressScale } from "./lib/motion";
import type Database from "./lib/db";
import { db as dbClient } from "./lib/db";
import { listen } from "./lib/event";
import { TitleBar } from "./components/TitleBar";
import type { Session as SupabaseSession } from "@supabase/supabase-js";
import {
  Play,
  Pause,
  RotateCcw,
  Settings2,
  Calendar as CalendarIcon,
  BookOpen,
  CloudCog,
  Bot,
  Plus,
  ChevronRight,
  ChevronDown,
  History,
  Send,
  Trash2,
  MoreHorizontal,
  CheckCircle2,
  Circle,
  Terminal,
  Copy,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogFooter } from "@/components/ui/dialog";
import { ProviderTabs } from "@/components/ui/provider-tabs";
import { getSupabase, initSupabase } from "./lib/supabase";
import { getSetting, setSetting } from "./lib/settings";
import {
  EMBEDDED_GOOGLE_CLIENT_ID,
  EMBEDDED_GOOGLE_CLIENT_SECRET,
  EMBEDDED_SUPABASE_URL,
  EMBEDDED_SUPABASE_ANON_KEY,
  BYOK_KEY_SIGNUP_URL,
} from "./lib/config";
import { syncNow } from "./lib/sync";
import { isObsidianVault } from "./lib/obsidian";
import {
  listAgentClis,
  saveAgentCli,
  setAgentCliEnabled,
  deleteAgentCli,
  listByokProviders,
  saveByokProvider,
  saveApiKey,
  getApiKey,
  describeAgentActivity,
  type AgentCli,
  type ByokProvider,
} from "./lib/agentIntegrations";
import { useTasks, type Task } from "./hooks/useTasks";
import { useGroups, type Group } from "./hooks/useGroups";
import { useMessages } from "./hooks/useMessages";
import { useChat } from "./hooks/useChat";
import { useSessions, openAgentInTerminal } from "./hooks/useSessions";
import { cn } from "./lib/utils";
import "./App.css";

const DEFAULT_GROUP_ID = "default";

function useDb() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    dbClient.execute("INSERT OR IGNORE INTO note_groups (id, title) VALUES ($1, $2)", [DEFAULT_GROUP_ID, "Inbox"]).then(() => setReady(true));
  }, []);
  return ready ? dbClient : null;
}

// ---------- Group sidebar (Obsidian-style nested folders) ----------

type GroupNode = Group & { children: GroupNode[] };

function buildTree(groups: Group[]): GroupNode[] {
  const nodes = new Map<string, GroupNode>(groups.map((g) => [g.id, { ...g, children: [] }]));
  const roots: GroupNode[] = [];
  for (const node of nodes.values()) {
    if (node.parent_id && nodes.has(node.parent_id)) {
      nodes.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function GroupTreeItem({
  node,
  depth,
  selectedId,
  onSelect,
  onAddChild,
  onDelete,
}: {
  node: GroupNode;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAddChild: (parentId: string) => void;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div>
      <div
        className={cn(
          "group flex items-center gap-1 rounded-md px-1.5 py-1 text-sm cursor-pointer border-l-2 transition-colors",
          selectedId === node.id
            ? "border-teal bg-accent/50 text-foreground"
            : "border-transparent text-muted-foreground hover:bg-accent/40 hover:text-foreground",
        )}
        style={{ paddingLeft: `${6 + depth * 14}px` }}
        onClick={() => onSelect(node.id)}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          className={cn("shrink-0", node.children.length === 0 && "invisible")}
        >
          {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </button>
        <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: node.color }} />
        <span className="flex-1 truncate">{node.title}</span>
        <div className="hidden group-hover:flex items-center gap-0.5">
          <button onClick={(e) => { e.stopPropagation(); onAddChild(node.id); }} title="Add sub-group">
            <Plus className="size-3" />
          </button>
          {node.id !== DEFAULT_GROUP_ID && (
            <button onClick={(e) => { e.stopPropagation(); onDelete(node.id); }} title="Delete group">
              <Trash2 className="size-3" />
            </button>
          )}
        </div>
      </div>
      {expanded &&
        node.children.map((child) => (
          <GroupTreeItem key={child.id} node={child} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} onAddChild={onAddChild} onDelete={onDelete} />
        ))}
    </div>
  );
}

function GroupSidebar({
  db,
  selectedId,
  onSelect,
  view,
  onViewChange,
}: {
  db: Database;
  selectedId: string | null;
  onSelect: (id: string) => void;
  view: "notes" | "sessions" | "settings";
  onViewChange: (v: "notes" | "sessions" | "settings") => void;
}) {
  const { groups, addGroup, deleteGroup } = useGroups(db);
  const tree = useMemo(() => buildTree(groups), [groups]);
  // Electron's renderer throws on window.prompt() (no native dialog implementation there),
  // so group creation needs its own in-app dialog instead of the original browser-only prompt.
  const [newGroupParent, setNewGroupParent] = useState<string | null>();
  const [newGroupTitle, setNewGroupTitle] = useState("");

  function handleAddChild(parentId: string | null) {
    setNewGroupParent(parentId);
    setNewGroupTitle("");
  }

  async function confirmAddGroup() {
    if (!newGroupTitle.trim()) return;
    const id = await addGroup(newGroupTitle, newGroupParent ?? null);
    if (id) onSelect(id);
    setNewGroupParent(undefined);
  }

  return (
    <div className="glass-surface w-56 shrink-0 border-r-0 flex flex-col">
      <div className="flex-1 overflow-auto px-2 py-2 space-y-3">
        <button
          onClick={() => onViewChange("sessions")}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-sm border-l-2 transition-colors",
            view === "sessions" ? "border-teal bg-accent/50 text-foreground" : "border-transparent text-muted-foreground hover:bg-accent/40 hover:text-foreground",
          )}
        >
          <History className="size-3.5" /> Sessions
        </button>

        <div>
          <div className="flex items-center justify-between px-1.5 mb-1">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground/70">Groups</span>
            <button onClick={() => handleAddChild(null)} title="New group">
              <Plus className="size-3.5 text-muted-foreground hover:text-foreground" />
            </button>
          </div>
          {tree.map((node) => (
            <GroupTreeItem
              key={node.id}
              node={node}
              depth={0}
              selectedId={view === "notes" ? selectedId : null}
              onSelect={(id) => {
                onViewChange("notes");
                onSelect(id);
              }}
              onAddChild={handleAddChild}
              onDelete={deleteGroup}
            />
          ))}
        </div>
      </div>
      <button
        onClick={() => onViewChange("settings")}
        className={cn(
          "flex items-center gap-2 border-t border-border px-3 py-2 text-sm text-left transition-colors",
          view === "settings" ? "text-foreground bg-accent/50" : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
        )}
      >
        <Settings2 className="size-3.5" /> Settings
      </button>
      <Dialog open={newGroupParent !== undefined} onOpenChange={(open) => !open && setNewGroupParent(undefined)}>
        <DialogContent>
          <DialogHeader>
            <p className="font-display text-base text-foreground">New group</p>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="Group name"
            value={newGroupTitle}
            onChange={(e) => setNewGroupTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && confirmAddGroup()}
          />
          <DialogFooter>
            <Button size="sm" onClick={confirmAddGroup}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------- Sticky-note grid (replaces the Kanban board) ----------

// Note tags survive only as a spine + dot accent (single-accent rule) — never a full card fill.
const NOTE_TAGS = [
  "var(--color-tag-butter)",
  "var(--color-tag-sage)",
  "var(--color-tag-sky)",
  "var(--color-tag-blush)",
  "var(--color-tag-lilac)",
  "var(--color-tag-clay)",
];

function formatDueAt(dueAt: string): string {
  const d = new Date(dueAt);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function StickyNoteCard({
  task,
  fallbackColor,
  isActive,
  onOpen,
  onOpenDetail,
  onToggleDone,
  onPause,
  onDelete,
}: {
  task: Task;
  fallbackColor: string;
  isActive: boolean;
  onOpen: () => void;
  onOpenDetail: () => void;
  onToggleDone: () => void;
  onPause: () => void;
  onDelete: () => void;
}) {
  const tagColor = task.color ?? fallbackColor;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      whileTap={pressScale}
      transition={springEnter()}
      className={cn(
        "squircle tag-spine p-3 bg-card border cursor-pointer hover:-translate-y-0.5",
        isActive ? "ring-2 ring-teal border-transparent" : "border-border hover:shadow-sm",
      )}
      style={{ "--tag-color": tagColor } as React.CSSProperties}
      onClick={onOpenDetail}
    >
      <div className="flex items-start gap-2">
        <span className="tag-dot size-1.5 rounded-full mt-1.5 shrink-0" style={{ "--tag-color": tagColor } as React.CSSProperties} />
        <p className={cn("flex-1 text-sm text-foreground whitespace-pre-wrap break-words", task.status === "done" && "line-through opacity-50")}>{task.title}</p>
        <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          {task.status === "running" && <span className="text-[10px] status-running mr-0.5">running</span>}
          {task.status === "running" ? (
            <Button variant="ghost" size="icon-xs" onClick={onPause} title="Pause">
              <Pause className="size-3" />
            </Button>
          ) : (
            <Button variant="ghost" size="icon-xs" onClick={onOpen} title="Open agent mode">
              <Play className="size-3" />
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs" title="More">
                <MoreHorizontal className="size-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onDelete} variant="destructive">
                <Trash2 className="size-3.5" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onToggleDone}
          title={task.status === "done" ? "Mark as not done" : "Mark as done"}
          className={cn("shrink-0 transition-colors", task.status === "done" ? "text-teal" : "text-muted-foreground/50 hover:text-foreground")}
        >
          {task.status === "done" ? <CheckCircle2 className="size-4" /> : <Circle className="size-4" />}
        </button>
        {task.due_at && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums">
            <CalendarIcon className="size-3" /> {formatDueAt(task.due_at)}
          </span>
        )}
      </div>
    </motion.div>
  );
}

function TaskDetailDialog({
  task,
  onOpenChange,
  onSave,
  onSetDueDate,
  onToggleDone,
  onDelete,
}: {
  task: Task;
  onOpenChange: (open: boolean) => void;
  onSave: (title: string, body: string) => void;
  onSetDueDate: (value: string) => void;
  onToggleDone: () => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [body, setBody] = useState(task.body);

  function saveAndClose(open: boolean) {
    if (!open && (title.trim() !== task.title || body !== task.body)) {
      onSave(title, body);
    }
    onOpenChange(open);
  }

  return (
    <Dialog open onOpenChange={saveAndClose}>
      <DialogContent className="pr-8">
        <DialogHeader className="pr-2">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="font-display text-base h-auto border-0 px-0 py-0 shadow-none focus-visible:ring-0"
          />
        </DialogHeader>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a description…"
          rows={5}
          className="w-full resize-none rounded-md border border-border bg-muted p-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <div className="flex items-center justify-between mt-4">
          <button
            onClick={onToggleDone}
            className={cn("flex h-7 items-center gap-1.5 text-sm transition-colors", task.status === "done" ? "text-teal" : "text-muted-foreground hover:text-foreground")}
          >
            {task.status === "done" ? <CheckCircle2 className="size-4" /> : <Circle className="size-4" />}
            {task.status === "done" ? "Done" : "Mark as done"}
          </button>
          <div className="flex h-7 items-center gap-1.5">
            <CalendarIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <Input type="date" className="h-7 w-auto text-xs" value={task.due_at ? task.due_at.slice(0, 10) : ""} onChange={(e) => onSetDueDate(e.target.value)} />
          </div>
        </div>
        <DialogFooter className="mt-4">
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              onDelete();
              onOpenChange(false);
            }}
          >
            <Trash2 className="size-3.5" /> Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddTaskDialog({ groupTitle, onAdd, onOpenChange }: { groupTitle: string; onAdd: (title: string, body: string) => Promise<void>; onOpenChange: (open: boolean) => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [adding, setAdding] = useState(false);

  async function submit() {
    if (!title.trim() || adding) return;
    setAdding(true);
    try {
      await onAdd(title, body);
      onOpenChange(false);
    } finally {
      setAdding(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="pr-8">
        <DialogHeader className="pr-2">
          <Input
            autoFocus
            placeholder={`New note in ${groupTitle}…`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && submit()}
            className="font-display text-base h-auto border-0 px-0 py-0 shadow-none focus-visible:ring-0"
          />
        </DialogHeader>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a description…"
          rows={5}
          className="w-full resize-none rounded-md border border-border bg-muted p-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <DialogFooter className="mt-4">
          <Button onClick={submit} disabled={!title.trim() || adding}>
            <Plus className="size-3.5" /> Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NoteGrid({
  group,
  tasksApi,
  activeTaskId,
  onOpenTask,
}: {
  group: Group;
  tasksApi: ReturnType<typeof useTasks>;
  activeTaskId: string | null;
  onOpenTask: (id: string) => void;
}) {
  const { tasks, addTask, pauseAgent, setDueDate, toggleDone, deleteTask, updateTaskDetails } = tasksApi;
  const [addOpen, setAddOpen] = useState(false);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const detailTask = tasks.find((t) => t.id === detailTaskId) ?? null;

  const doneCount = tasks.filter((t) => t.status === "done").length;

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-8 py-6">
        <div className="mb-6">
          <h1 className="font-display text-xl text-foreground">{group.title}</h1>
          {tasks.length > 0 && (
            <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">
              {tasks.length} note{tasks.length === 1 ? "" : "s"} · {doneCount} done
            </p>
          )}
        </div>
        <Button onClick={() => setAddOpen(true)} className="mb-6">
          <Plus className="size-3.5" /> Add note
        </Button>
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
          {tasks.map((t, i) => (
            <StickyNoteCard
              key={t.id}
              task={t}
              fallbackColor={group.color !== "#fef08a" ? group.color : NOTE_TAGS[i % NOTE_TAGS.length]}
              isActive={t.id === activeTaskId}
              onOpen={() => onOpenTask(t.id)}
              onOpenDetail={() => setDetailTaskId(t.id)}
              onToggleDone={() => toggleDone(t)}
              onPause={() => pauseAgent(t.id)}
              onDelete={() => deleteTask(t.id)}
            />
          ))}
        </div>
        {tasks.length === 0 && (
          <div className="flex flex-col items-center text-center gap-2 py-16 text-muted-foreground">
            <Bot className="size-6 opacity-40" />
            <p className="text-sm">No notes here yet — add one above to give an agent something to do.</p>
          </div>
        )}
        {detailTask && (
          <TaskDetailDialog
            key={detailTask.id}
            task={detailTask}
            onOpenChange={(open) => !open && setDetailTaskId(null)}
            onSave={(t, b) => updateTaskDetails(detailTask.id, t, b)}
            onSetDueDate={(v) => setDueDate(detailTask, v)}
            onToggleDone={() => toggleDone(detailTask)}
            onDelete={() => deleteTask(detailTask.id)}
          />
        )}
        {addOpen && <AddTaskDialog groupTitle={group.title} onAdd={(t, b) => addTask(t, b)} onOpenChange={setAddOpen} />}
      </div>
    </div>
  );
}

// ---------- Agent panel (right-hand: transcript + follow-up) ----------

function AgentPanel({
  db,
  task,
  clis,
  byokProviders,
  tasksApi,
  onClose,
}: {
  db: Database;
  task: Task;
  clis: AgentCli[];
  byokProviders: ByokProvider[];
  tasksApi: ReturnType<typeof useTasks>;
  onClose: () => void;
}) {
  const { messages, addMessage, refresh: refreshMessages } = useMessages(db, task.id);
  const chat = useChat(db, task.id, addMessage);
  const [followup, setFollowup] = useState("");
  const [lastRun, setLastRun] = useState<{ run_kind: string; agent: string; session_id: string | null } | null>(null);
  const [idCopied, setIdCopied] = useState(false);
  // useTasks' agent-event handler writes the agent's reply straight to the messages table
  // (not through this hook's own addMessage), so useMessages has no way to know new rows
  // landed — without this, the panel just sits frozen on the pre-run state forever, since
  // task.status is the only signal here that a run actually finished.
  useEffect(() => {
    refreshMessages();
  }, [task.status, refreshMessages]);
  // window.prompt() throws in Electron's renderer, so the first-run "which folder should
  // this agent work in" question needs its own dialog instead of the browser-only prompt.
  const [pendingCli, setPendingCli] = useState<AgentCli | null>(null);
  const [projectDirInput, setProjectDirInput] = useState("");
  const [pendingFollowupText, setPendingFollowupText] = useState<string | null>(null);

  async function refreshLastRun() {
    const rows = await db.select<{ run_kind: string; agent: string; session_id: string | null }[]>(
      "SELECT run_kind, agent, session_id FROM agent_runs WHERE task_id = $1 ORDER BY started_at DESC LIMIT 1",
      [task.id],
    );
    setLastRun(rows[0] ?? null);
  }

  async function copySessionId() {
    if (!lastRun?.session_id) return;
    await navigator.clipboard.writeText(lastRun.session_id);
    setIdCopied(true);
    setTimeout(() => setIdCopied(false), 1500);
  }

  useEffect(() => {
    refreshLastRun();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, task.id, messages.length]);

  const cliLogs = tasksApi.logs[task.id];
  const running = task.status === "running";

  async function start(kind: "cli" | "chat", id: string) {
    if (kind === "cli") {
      const cli = clis.find((c) => c.id === id);
      if (!cli) return;
      if (!task.project_dir) {
        setPendingCli(cli);
        setProjectDirInput("");
        return;
      }
      await tasksApi.runAgent(task, cli);
    } else {
      const provider = byokProviders.find((p) => p.id === id);
      if (provider) await chat.sendChat(provider, [], task.body ? `${task.title}\n\n${task.body}` : task.title);
    }
    await refreshLastRun();
  }

  async function browseProjectDir() {
    const folder = await window.api.selectFolder();
    if (folder) setProjectDirInput(folder);
  }

  async function confirmProjectDirAndStart() {
    if (!pendingCli || !projectDirInput.trim()) return;
    await tasksApi.setProjectDir(task.id, projectDirInput.trim());
    const updatedTask = { ...task, project_dir: projectDirInput.trim() };
    if (pendingFollowupText) {
      setFollowup("");
      await tasksApi.resumeAgent(updatedTask, pendingFollowupText);
      setPendingFollowupText(null);
    } else {
      await tasksApi.runAgent(updatedTask, pendingCli);
    }
    setPendingCli(null);
    await refreshLastRun();
  }

  // Older notes can reach here with a lastRun but no project_dir (e.g. never set, or set
  // before that flow existed) — resumeAgent's runAgent call silently no-ops without one, so
  // ask for it via the same dialog the initial "Run with" flow uses, instead of the
  // follow-up appearing to do nothing.
  async function sendFollowup() {
    const text = followup.trim();
    if (!text || !lastRun) return;
    if (!task.project_dir) {
      const cli = clis.find((c) => c.id === lastRun.agent) ?? clis.find((c) => c.enabled) ?? null;
      if (cli) {
        setPendingCli(cli);
        setPendingFollowupText(text);
        setProjectDirInput("");
      }
      return;
    }
    setFollowup("");
    if (lastRun.run_kind === "cli") {
      await tasksApi.resumeAgent(task, text);
    } else {
      const provider = byokProviders.find((p) => p.id === lastRun.agent);
      if (provider) await chat.sendChat(provider, messages, text);
    }
  }

  return (
    <motion.div
      initial={{ x: 32, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={springEnter()}
      className="squircle glass-surface tag-spine w-96 shrink-0 flex flex-col"
      style={{ "--tag-color": task.color ?? "var(--color-teal)" } as React.CSSProperties}
    >
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <p className="font-display text-sm truncate">{task.title}</p>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xs">
          Close
        </button>
      </div>
      {lastRun?.run_kind === "cli" && lastRun.session_id && (
        <div className="flex items-center gap-1.5 px-4 py-1.5 border-b border-border text-[11px] text-muted-foreground">
          <span className="uppercase tracking-wide shrink-0">{lastRun.agent} session</span>
          <span className="font-mono truncate" title={lastRun.session_id}>
            {lastRun.session_id}
          </span>
          <button onClick={copySessionId} className="shrink-0 hover:text-foreground" title="Copy session id">
            {idCopied ? <Check className="size-3 text-teal" /> : <Copy className="size-3" />}
          </button>
          <button
            onClick={() => openAgentInTerminal(db, lastRun.agent, lastRun.session_id!, task.project_dir)}
            className="shrink-0 hover:text-foreground"
            title="Open in terminal"
          >
            <Terminal className="size-3" />
          </button>
        </div>
      )}

      <div className="flex-1 overflow-auto px-4 py-3 space-y-3">
        {messages.map((m) => (
          <div key={m.id} className={cn("rounded-md px-2.5 py-2 text-sm", m.role === "user" ? "bg-muted" : "bg-teal/10")}>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">{m.role}</p>
            <p className="whitespace-pre-wrap">{m.content}</p>
          </div>
        ))}
        {chat.running && (
          <div className="rounded-md px-2.5 py-2 text-sm bg-teal/10">
            <p className={cn("text-[10px] uppercase tracking-wide text-muted-foreground mb-1", !chat.streamingText && "status-running")}>assistant</p>
            <p className="whitespace-pre-wrap">{chat.streamingText}</p>
          </div>
        )}
        {running && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="status-running size-1.5 rounded-full bg-teal shrink-0" />
            {cliLogs && cliLogs.length > 0 ? describeAgentActivity(cliLogs) : "Agent is thinking…"}
          </p>
        )}
        {messages.length === 0 && !chat.running && !running && (
          <div className="flex flex-col items-center text-center gap-2 py-10 text-muted-foreground">
            <Bot className="size-6 opacity-40" />
            <p className="text-sm">Not started yet — pick an agent below.</p>
          </div>
        )}
      </div>

      <div className="border-t border-border p-3 space-y-2">
        {!lastRun ? (
          <div className="space-y-1.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Run with</p>
            <div className="flex flex-wrap gap-1.5">
              {clis.filter((c) => c.enabled).map((c) => (
                <Button key={c.id} variant="outline" size="sm" onClick={() => start("cli", c.id)}>
                  <Bot className="size-3.5" /> {c.label}
                </Button>
              ))}
              {byokProviders.filter((p) => p.enabled).map((p) => (
                <Button key={p.id} variant="outline" size="sm" onClick={() => start("chat", p.id)}>
                  {p.label}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {!running && !chat.running && (
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                {task.status === "done" ? (
                  <>
                    <CheckCircle2 className="size-3 text-teal" /> Agent marked this complete — following up will reopen it.
                  </>
                ) : (
                  "Not fully done yet — send a follow-up to continue."
                )}
              </p>
            )}
            {task.status === "paused" && lastRun.run_kind === "cli" && (
              <Button variant="outline" size="sm" onClick={() => tasksApi.resumeAgent(task)}>
                <RotateCcw className="size-3.5" /> Resume
              </Button>
            )}
            <div className="flex items-center gap-2">
              <Input
                placeholder={running || chat.running ? "Agent is working…" : "Follow-up question or instruction…"}
                value={followup}
                disabled={running || chat.running}
                onChange={(e) => setFollowup(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendFollowup()}
              />
              <Button variant="ghost" size="icon-sm" disabled={running || chat.running} onClick={sendFollowup}>
                <Send className="size-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>
      <Dialog
        open={pendingCli !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingCli(null);
            setPendingFollowupText(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <p className="font-display text-base text-foreground">Project directory</p>
            <p className="text-sm text-muted-foreground">Where should {pendingCli?.label} work?</p>
          </DialogHeader>
          <div className="flex gap-2">
            <Input
              autoFocus
              placeholder="c:/path/to/project"
              value={projectDirInput}
              onChange={(e) => setProjectDirInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && confirmProjectDirAndStart()}
            />
            <Button variant="outline" onClick={browseProjectDir}>
              Browse…
            </Button>
          </div>
          <DialogFooter>
            <Button size="sm" onClick={confirmProjectDirAndStart} disabled={!projectDirInput.trim()}>
              Start
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

// ---------- Global Sessions view ----------

function SessionsView({ db, onOpenTask }: { db: Database; onOpenTask: (taskId: string) => void }) {
  const { sessions, copyTerminalCommand, openInTerminal } = useSessions(db);
  const [copied, setCopied] = useState<string | null>(null);

  async function handleCopy(session: (typeof sessions)[number]) {
    const command = await copyTerminalCommand(session);
    if (command) {
      setCopied(session.id);
      setTimeout(() => setCopied(null), 1500);
    }
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-8 py-6">
        <h1 className="font-display text-xl text-foreground mb-5">Sessions</h1>
        <div className="space-y-1 min-w-fit">
          {sessions.map((s) => {
            const state = s.end_reason ?? (s.ended_at ? "done" : "running");
            return (
              <div key={s.id} className="group flex items-center gap-3 border-b border-border py-2.5 text-sm">
                <span
                  className={cn(
                    "size-1.5 rounded-full shrink-0",
                    state === "running" ? "bg-teal status-running" : state === "error" ? "bg-destructive" : "bg-muted-foreground/40",
                  )}
                />
                <span className="flex-1 min-w-[100px] truncate">{s.task_title}</span>
                <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground w-24 truncate">{s.agent}</span>
                {s.session_id ? (
                  <span className="shrink-0 whitespace-nowrap font-mono text-[11px] text-muted-foreground/70 w-20 truncate" title={s.session_id}>
                    {s.session_id.slice(0, 8)}
                  </span>
                ) : (
                  <span className="shrink-0 w-20" />
                )}
                <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground w-20 capitalize">{state}</span>
                <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground/60 w-36 tabular-nums">{s.started_at}</span>
                <div className="shrink-0 flex items-center gap-0.5 opacity-70 group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="icon-sm" onClick={() => onOpenTask(s.task_id)} title="Resume in app">
                    <Play className="size-3.5" />
                  </Button>
                  {s.run_kind === "cli" && s.session_id && (
                    <>
                      <Button variant="ghost" size="icon-sm" onClick={() => openInTerminal(s)} title="Open in terminal">
                        <Terminal className="size-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon-sm" onClick={() => handleCopy(s)} title="Copy resume command">
                        {copied === s.id ? <Check className="size-3.5 text-teal" /> : <Copy className="size-3.5" />}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {sessions.length === 0 && (
            <div className="flex flex-col items-center text-center gap-2 py-16 text-muted-foreground">
              <History className="size-6 opacity-40" />
              <p className="text-sm">No agent runs yet — sessions appear here once you run a note.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Capture bar (unchanged) ----------

function CaptureBar() {
  const db = useDb();
  const [title, setTitle] = useState("");

  async function submit() {
    if (!db || !title.trim()) return;
    await db.execute("INSERT OR IGNORE INTO note_groups (id, title) VALUES ($1, $2)", [DEFAULT_GROUP_ID, "Inbox"]);
    const id = crypto.randomUUID();
    await db.execute("INSERT INTO tasks (id, note_group_id, title) VALUES ($1, $2, $3)", [id, DEFAULT_GROUP_ID, title.trim()]);
    await window.api.window.close();
  }

  return (
    <main className="min-h-screen bg-background flex items-center">
      <div className="w-2 h-full" style={{ WebkitAppRegion: "drag" } as React.CSSProperties} />
      <input
        autoFocus
        className="flex-1 px-3 py-3 outline-none bg-transparent text-foreground placeholder:text-muted-foreground text-sm"
        placeholder="Quick capture a task, press Enter…"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") window.api.window.close();
        }}
      />
    </main>
  );
}

// ---------- Settings (adds an "Agents" tab ahead of the existing ones) ----------

const BYOK_TABS = [
  { id: "openai", name: "OpenAI", kind: "openai-compatible", defaultModel: "gpt-4o-mini" },
  { id: "anthropic", name: "Anthropic", kind: "anthropic", defaultModel: "claude-sonnet-4-5" },
  { id: "local", name: "Local", kind: "openai-compatible", defaultModel: "llama3" },
  { id: "custom", name: "Custom", kind: "openai-compatible", defaultModel: "" },
];

function AgentsSettings({ db }: { db: Database }) {
  const [clis, setClis] = useState<AgentCli[]>([]);
  const [newCli, setNewCli] = useState({ label: "", command: "", args_template: "" });

  const [providers, setProviders] = useState<ByokProvider[]>([]);
  const [selectedProvider, setSelectedProvider] = useState("openai");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [status, setStatus] = useState("");

  async function refreshClis() {
    setClis(await listAgentClis(db));
  }
  async function refreshProviders() {
    setProviders(await listByokProviders(db));
  }

  useEffect(() => {
    refreshClis();
    refreshProviders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db]);

  useEffect(() => {
    const tab = BYOK_TABS.find((t) => t.id === selectedProvider)!;
    const existing = providers.find((p) => p.id === selectedProvider);
    setModel(existing?.default_model ?? tab.defaultModel);
    setBaseUrl(existing?.base_url ?? "");
    setApiKey("");
    getApiKey(selectedProvider).then((k) => setApiKey(k ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProvider, providers]);

  async function addCustomCli() {
    if (!newCli.label.trim() || !newCli.command.trim() || !newCli.args_template.trim()) return;
    await saveAgentCli(db, {
      id: crypto.randomUUID(),
      label: newCli.label.trim(),
      command: newCli.command.trim(),
      args_template: newCli.args_template.trim(),
      resume_args_template: "[]",
      terminal_resume_template: "",
      enabled: 1,
    });
    setNewCli({ label: "", command: "", args_template: "" });
    await refreshClis();
  }

  async function saveProvider() {
    const tab = BYOK_TABS.find((t) => t.id === selectedProvider)!;
    await saveApiKey(selectedProvider, apiKey.trim());
    await saveByokProvider(db, {
      id: selectedProvider,
      label: tab.name,
      kind: tab.kind,
      base_url: baseUrl.trim() || null,
      default_model: model.trim() || null,
      enabled: 1,
    });
    setStatus("Saved.");
    await refreshProviders();
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2.5">
        <h2 className="text-xs text-muted-foreground">Agent CLIs</h2>
        {clis.map((cli) => (
          <div key={cli.id} className="flex items-center gap-2 text-sm py-1">
            <label className="flex items-center gap-1.5 flex-1">
              <input type="checkbox" checked={!!cli.enabled} onChange={(e) => setAgentCliEnabled(db, cli.id, e.target.checked).then(refreshClis)} />
              {cli.label}
            </label>
            <span className="text-xs text-muted-foreground/60">{cli.command}</span>
            {!cli.is_builtin && (
              <button onClick={() => deleteAgentCli(db, cli.id).then(refreshClis)} title="Remove">
                <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
              </button>
            )}
          </div>
        ))}
        <div className="space-y-1.5 pt-2 border-t border-border">
          <p className="text-xs text-muted-foreground">Add a custom CLI agent</p>
          <Input placeholder="Label" value={newCli.label} onChange={(e) => setNewCli({ ...newCli, label: e.target.value })} />
          <Input placeholder="Command (e.g. my-agent)" value={newCli.command} onChange={(e) => setNewCli({ ...newCli, command: e.target.value })} />
          <Input
            placeholder='Args template JSON, e.g. ["run","{prompt}"]'
            value={newCli.args_template}
            onChange={(e) => setNewCli({ ...newCli, args_template: e.target.value })}
          />
          <Button variant="ghost" onClick={addCustomCli}>
            Add agent
          </Button>
        </div>
      </section>

      <section className="space-y-2.5 border-t border-border pt-5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs text-muted-foreground">AI providers (BYOK)</h2>
          {BYOK_KEY_SIGNUP_URL[selectedProvider] && (
            <button
              onClick={() => window.api.openExternal(BYOK_KEY_SIGNUP_URL[selectedProvider])}
              className="text-xs text-teal hover:underline"
            >
              Get an API key ↗
            </button>
          )}
        </div>
        <ProviderTabs providers={BYOK_TABS} selectedId={selectedProvider} onSelect={setSelectedProvider} />
        <Input type="password" placeholder="Paste your API key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        <Input placeholder="Model" value={model} onChange={(e) => setModel(e.target.value)} />
        {(selectedProvider === "local" || selectedProvider === "custom") && (
          <Input placeholder="Base URL (OpenAI-compatible)" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        )}
        <Button variant="ghost" onClick={saveProvider}>
          Save provider
        </Button>
        {status && <p className="text-sm text-muted-foreground">{status}</p>}
      </section>
    </div>
  );
}

function SettingsView() {
  const db = useDb();
  const [url, setUrl] = useState("");
  const [anonKey, setAnonKey] = useState("");
  const [useCustomSupabase, setUseCustomSupabase] = useState(false);
  const [session, setSession] = useState<SupabaseSession | null>(null);
  const [email, setEmail] = useState("");
  const [linkSent, setLinkSent] = useState(false);
  const [status, setStatus] = useState("");
  const [googleEmail, setGoogleEmail] = useState<string | null>(null);
  const [googleStatus, setGoogleStatus] = useState("");
  const [vaultPath, setVaultPath] = useState("");
  const [vaultFolder, setVaultFolder] = useState("inbox");
  const [vaultStatus, setVaultStatus] = useState("");

  useEffect(() => {
    if (!db) return;
    (async () => {
      const savedUrl = await getSetting(db, "supabase_url");
      const savedKey = await getSetting(db, "supabase_anon_key");
      const effectiveUrl = savedUrl || EMBEDDED_SUPABASE_URL;
      const effectiveKey = savedKey || EMBEDDED_SUPABASE_ANON_KEY;
      if (savedUrl && savedKey) {
        setUrl(savedUrl);
        setAnonKey(savedKey);
        setUseCustomSupabase(true);
      }
      if (effectiveUrl && effectiveKey) {
        const sb = initSupabase(effectiveUrl, effectiveKey);
        const { data } = await sb.auth.getSession();
        setSession(data.session);
      }
      const signedIn = await window.api.googleAuthStatus();
      if (signedIn) setGoogleEmail(await getSetting(db, "google_email"));
      const savedVaultPath = await getSetting(db, "obsidian_vault_path");
      const savedVaultFolder = await getSetting(db, "obsidian_folder");
      if (savedVaultPath) setVaultPath(savedVaultPath);
      if (savedVaultFolder) setVaultFolder(savedVaultFolder);
    })();
  }, [db]);

  // Both the magic-link email flow and the Google sign-in flow land here via the same
  // loopback listener (electron/authRedirect.cjs) — Supabase's PKCE flow needs the
  // returned `code` explicitly exchanged for a session, which nothing was doing before
  // (the magic-link flow never actually finished signing the user in).
  useEffect(() => {
    const unlisten = listen<{ code: string | null }>("email-auth-redirect", async (e) => {
      const sb = getSupabase();
      if (!sb || !e.payload.code) return;
      const { data, error } = await sb.auth.exchangeCodeForSession(e.payload.code);
      if (error) {
        setStatus(`Sign-in failed: ${error.message}`);
        return;
      }
      setSession(data.session);
      setStatus("Signed in.");
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // googleAuthStart (electron/googleCalendarManager.cjs) runs the PKCE flow in the
  // background and reports its outcome here — nothing was listening for this before, so
  // the UI never reflected a completed (or failed) Google sign-in.
  useEffect(() => {
    const unlisten = listen<{ success: boolean; email?: string; error?: string }>("google-auth-result", async (e) => {
      if (e.payload.success && e.payload.email) {
        if (db) await setSetting(db, "google_email", e.payload.email);
        setGoogleEmail(e.payload.email);
        setGoogleStatus("Connected.");
      } else {
        setGoogleStatus(`Sign-in failed: ${e.payload.error ?? "unknown error"}`);
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [db]);

  async function connectGoogle() {
    if (!EMBEDDED_GOOGLE_CLIENT_ID || !EMBEDDED_GOOGLE_CLIENT_SECRET) {
      setGoogleStatus("This build has no Google Calendar app configured yet.");
      return;
    }
    setGoogleStatus("Opening browser for Google sign-in...");
    await window.api.googleAuthStart(EMBEDDED_GOOGLE_CLIENT_ID, EMBEDDED_GOOGLE_CLIENT_SECRET);
  }

  async function disconnectGoogle() {
    await window.api.googleAuthSignOut();
    setGoogleEmail(null);
    setGoogleStatus("Disconnected.");
  }

  async function saveVaultSettings() {
    if (!db || !vaultPath.trim()) return;
    await setSetting(db, "obsidian_vault_path", vaultPath.trim());
    await setSetting(db, "obsidian_folder", vaultFolder.trim() || "inbox");
    const detected = await isObsidianVault(vaultPath.trim());
    setVaultStatus(detected ? "Obsidian vault detected — saved." : "Saved (no .obsidian folder found at that path — check it's the vault root).");
  }

  async function pickVaultFolder() {
    const folder = await window.api.selectFolder();
    if (folder) setVaultPath(folder);
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
    const port = await window.api.startLocalRedirectListener();
    const { error } = await sb.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true, emailRedirectTo: `http://127.0.0.1:${port}` },
    });
    setStatus(error ? error.message : "Link sent — check your email and click it.");
    if (!error) setLinkSent(true);
  }

  async function signInWithGoogle() {
    const sb = getSupabase();
    if (!sb) return;
    setStatus("Opening browser for sign-in...");
    const port = await window.api.startLocalRedirectListener();
    const { data, error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `http://127.0.0.1:${port}`, skipBrowserRedirect: true },
    });
    if (error || !data.url) {
      setStatus(error?.message ?? "Could not start Google sign-in.");
      return;
    }
    await window.api.openExternal(data.url);
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
    try {
      await syncNow(db, session.user.id);
      setStatus("Synced.");
    } catch (err) {
      setStatus(`Sync failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (!db) return null;

  return (
    <main className="flex-1 overflow-auto bg-background px-7 py-7">
      <h1 className="font-display text-xl text-foreground mb-5">Settings</h1>

      <Tabs defaultValue="agents">
        <TabsList variant="line" className="w-full justify-start border-b border-border h-auto pb-0 mb-5">
          <TabsTrigger value="agents">
            <Bot className="size-4" /> Agents
          </TabsTrigger>
          <TabsTrigger value="integrations">
            <CloudCog className="size-4" /> Integrations
          </TabsTrigger>
        </TabsList>

        <TabsContent value="agents">
          <AgentsSettings db={db} />
        </TabsContent>

        <TabsContent value="integrations" className="space-y-6">
          <section className="space-y-2.5">
            <h2 className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarIcon className="size-3.5" /> Google Calendar
            </h2>
            {googleEmail ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Connected as {googleEmail}</p>
                <Button variant="ghost" onClick={disconnectGoogle}>
                  Disconnect
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Push task due-dates to a dedicated "Dispatch" calendar — one click, no setup.</p>
                <Button variant="outline" onClick={connectGoogle}>
                  Connect Google Calendar
                </Button>
              </div>
            )}
            {googleStatus && <p className="text-sm text-muted-foreground">{googleStatus}</p>}
          </section>

          <section className="space-y-2.5 border-t border-border pt-5">
            <h2 className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <BookOpen className="size-3.5" /> Obsidian
            </h2>
            <div className="flex gap-2">
              <Input placeholder="Vault path" value={vaultPath} readOnly onClick={pickVaultFolder} className="cursor-pointer" />
              <Button variant="outline" onClick={pickVaultFolder}>
                Choose folder…
              </Button>
            </div>
            <Input placeholder="Target folder (default: inbox)" value={vaultFolder} onChange={(e) => setVaultFolder(e.target.value)} />
            <Button variant="ghost" onClick={saveVaultSettings}>
              Save
            </Button>
            {vaultStatus && <p className="text-sm text-muted-foreground">{vaultStatus}</p>}
          </section>

          <section className="space-y-2.5 border-t border-border pt-5">
            <h2 className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CloudCog className="size-3.5" /> Cross-device sync
            </h2>
            {session ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Signed in as {session.user.email}</p>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={doSync}>
                    Sync now
                  </Button>
                  <Button variant="ghost" onClick={signOut}>
                    Sign out
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Sign in to sync your notes across devices — no project setup needed.</p>
                <Button variant="outline" onClick={signInWithGoogle}>
                  Continue with Google
                </Button>
                <div className="flex items-center gap-2 text-xs text-muted-foreground/60 py-1">
                  <span className="flex-1 border-t border-border" /> or <span className="flex-1 border-t border-border" />
                </div>
                <Input placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                <Button variant="ghost" size="sm" onClick={sendMagicLink}>
                  Send sign-in link by email
                </Button>
                {linkSent && <p className="text-sm text-muted-foreground">Click the link in your email — this window will pick it up automatically.</p>}
              </div>
            )}
            {status && <p className="text-sm text-muted-foreground">{status}</p>}
            <button
              onClick={() => setUseCustomSupabase((v) => !v)}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              {useCustomSupabase ? "Hide" : "Use my own Supabase project"}
            </button>
            {useCustomSupabase && (
              <div className="space-y-1.5 pt-1">
                <Input placeholder="Project URL (https://xxxx.supabase.co)" value={url} onChange={(e) => setUrl(e.target.value)} />
                <Input placeholder="anon public key" value={anonKey} onChange={(e) => setAnonKey(e.target.value)} />
                <Button variant="ghost" size="sm" onClick={saveConnection}>
                  Save custom project
                </Button>
              </div>
            )}
          </section>
        </TabsContent>
      </Tabs>
    </main>
  );
}

// ---------- Detached sticky-note popup window (unchanged entry point) ----------

function StickyPopup({ groupId }: { groupId: string }) {
  const db = useDb();
  const [group, setGroup] = useState<Group | null>(null);
  const tasksApi = useTasks(dbClient, groupId);

  useEffect(() => {
    if (!db) return;
    db.select<Group[]>("SELECT id, title, color, parent_id FROM note_groups WHERE id = $1", [groupId]).then((rows) => setGroup(rows[0] ?? null));
  }, [db, groupId]);

  if (!db || !group) return null;

  return (
    <main className="min-h-screen bg-background flex flex-col">
      <div className="h-4 shrink-0" style={{ WebkitAppRegion: "drag" } as React.CSSProperties} />
      <NoteGrid group={group} tasksApi={tasksApi} activeTaskId={null} onOpenTask={() => {}} />
    </main>
  );
}

// ---------- Main workspace: sidebar + note grid / sessions + agent panel ----------

function Workspace() {
  const db = useDb();
  const [selectedGroupId, setSelectedGroupId] = useState<string>(DEFAULT_GROUP_ID);
  const [view, setView] = useState<"notes" | "sessions" | "settings">("notes");
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [byokProviders, setByokProviders] = useState<ByokProvider[]>([]);

  const tasksApi = useTasks(dbClient, selectedGroupId);

  useEffect(() => {
    if (!db) return;
    db.select<Group[]>("SELECT id, title, color, parent_id FROM note_groups").then(setGroups);
    listByokProviders(db).then(setByokProviders);
  }, [db, tasksApi.tasks.length]);

  // Settings is embedded (not a separate OS window); the tray's "Settings" item and the
  // in-app "Settings" invoke both just switch this view via the same navigate-to event.
  useEffect(() => {
    const unlisten = listen<"notes" | "sessions" | "settings">("navigate-to", (e) => setView(e.payload));
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  async function navigateToTask(taskId: string) {
    if (!db) return;
    const rows = await db.select<{ note_group_id: string }[]>("SELECT note_group_id FROM tasks WHERE id = $1", [taskId]);
    if (rows[0]) setSelectedGroupId(rows[0].note_group_id);
    setView("notes");
    setActiveTaskId(taskId);
  }

  if (!db) return null;

  const group = groups.find((g) => g.id === selectedGroupId);
  const activeTask = tasksApi.tasks.find((t) => t.id === activeTaskId) ?? null;

  return (
    <div className="h-screen flex flex-col">
      <TitleBar db={db} />
      <main className="flex-1 flex overflow-hidden">
        <GroupSidebar db={db} selectedId={selectedGroupId} onSelect={setSelectedGroupId} view={view} onViewChange={setView} />

        {view === "settings" ? (
          <SettingsView />
        ) : view === "sessions" ? (
          <SessionsView db={db} onOpenTask={navigateToTask} />
        ) : group ? (
          <NoteGrid group={group} tasksApi={tasksApi} activeTaskId={activeTaskId} onOpenTask={setActiveTaskId} />
        ) : (
          <div className="flex-1" />
        )}

        {activeTask && (
          <AgentPanel db={db} task={activeTask} clis={tasksApi.clis} byokProviders={byokProviders} tasksApi={tasksApi} onClose={() => setActiveTaskId(null)} />
        )}
      </main>
    </div>
  );
}

function App() {
  const params = new URLSearchParams(window.location.search);
  const sticky = params.get("sticky");
  const capture = params.get("capture");

  if (capture) return <CaptureBar />;
  if (sticky) return <StickyPopup groupId={sticky} />;
  return <Workspace />;
}

export default App;
