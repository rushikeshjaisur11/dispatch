CREATE TABLE agent_runs (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    agent TEXT NOT NULL,
    session_id TEXT,
    transcript_path TEXT,
    end_reason TEXT,
    summary TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT
);

CREATE INDEX idx_agent_runs_task ON agent_runs(task_id);
