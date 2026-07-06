-- Run once in Supabase Dashboard > SQL Editor. Mirrors the local SQLite schema for the
-- 3 tables src/lib/sync.ts actually syncs (note_groups, tasks, agent_runs), plus a
-- user_id column (added by pushChanges, filtered on by pullChanges) that has no local
-- equivalent since the local file is single-user. Date columns stay `text` (not
-- timestamptz) so the exact SQLite `datetime('now')` strings round-trip unchanged --
-- the sync watermark comparisons rely on plain string comparison already working
-- locally, and this avoids an implicit timezone conversion surprising it.

create table if not exists note_groups (
  id text primary key,
  title text not null,
  color text not null default '#fef08a',
  pos_x double precision not null default 100,
  pos_y double precision not null default 100,
  width double precision not null default 320,
  height double precision not null default 400,
  pinned integer not null default 0,
  created_at text not null default to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  updated_at text not null default to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  parent_id text references note_groups(id),
  user_id uuid not null references auth.users(id)
);

create table if not exists tasks (
  id text primary key,
  note_group_id text not null references note_groups(id),
  title text not null,
  body text not null default '',
  status text not null default 'todo',
  assignee text not null default 'me',
  project_dir text,
  due_at text,
  calendar_event_id text,
  machine_id text,
  updated_at text not null default to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  deleted_at text,
  color text,
  user_id uuid not null references auth.users(id)
);
create index if not exists idx_tasks_note_group on tasks(note_group_id);

create table if not exists agent_runs (
  id text primary key,
  task_id text not null references tasks(id),
  agent text not null,
  session_id text,
  transcript_path text,
  end_reason text,
  summary text,
  started_at text not null default to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  ended_at text,
  run_kind text not null default 'cli',
  user_id uuid not null references auth.users(id)
);
create index if not exists idx_agent_runs_task on agent_runs(task_id);

-- Row-level security: each signed-in user only ever sees/writes their own rows.
alter table note_groups enable row level security;
alter table tasks enable row level security;
alter table agent_runs enable row level security;

create policy "own rows" on note_groups for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on tasks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on agent_runs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
