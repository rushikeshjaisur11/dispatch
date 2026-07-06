ALTER TABLE note_groups ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'));
