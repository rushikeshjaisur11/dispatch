ALTER TABLE note_groups ADD COLUMN parent_id TEXT REFERENCES note_groups(id);
