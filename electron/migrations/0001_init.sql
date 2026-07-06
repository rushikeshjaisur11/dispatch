CREATE TABLE note_groups (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#fef08a',
    pos_x REAL NOT NULL DEFAULT 100,
    pos_y REAL NOT NULL DEFAULT 100,
    width REAL NOT NULL DEFAULT 320,
    height REAL NOT NULL DEFAULT 400,
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    note_group_id TEXT NOT NULL REFERENCES note_groups(id),
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'todo',
    assignee TEXT NOT NULL DEFAULT 'me',
    project_dir TEXT,
    due_at TEXT,
    calendar_event_id TEXT,
    machine_id TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
);

CREATE INDEX idx_tasks_note_group ON tasks(note_group_id);
