CREATE TABLE byok_providers (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'openai-compatible',
    base_url TEXT,
    default_model TEXT,
    enabled INTEGER NOT NULL DEFAULT 0
);
