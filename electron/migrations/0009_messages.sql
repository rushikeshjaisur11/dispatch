CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    run_id TEXT REFERENCES agent_runs(id),
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_messages_task ON messages(task_id);

ALTER TABLE agent_runs ADD COLUMN run_kind TEXT NOT NULL DEFAULT 'cli';
