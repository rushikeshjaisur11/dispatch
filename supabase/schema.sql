-- Run this once in the Supabase project's SQL editor (Dashboard -> SQL Editor -> New query).
-- Mirrors src-tauri/migrations/*.sql, scoped per-user with row level security.

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  entitlement text not null default 'free_beta',
  created_at timestamptz not null default now()
);

create table note_groups (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  color text not null default '#fef08a',
  pos_x double precision not null default 100,
  pos_y double precision not null default 100,
  width double precision not null default 320,
  height double precision not null default 400,
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table tasks (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  note_group_id uuid not null references note_groups (id) on delete cascade,
  title text not null,
  body text not null default '',
  status text not null default 'todo',
  assignee text not null default 'me',
  project_dir text,
  due_at timestamptz,
  calendar_event_id text,
  machine_id text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table agent_runs (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  task_id uuid not null references tasks (id) on delete cascade,
  agent text not null,
  session_id text,
  transcript_path text,
  end_reason text,
  summary text,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create index idx_tasks_note_group on tasks (note_group_id);
create index idx_agent_runs_task on agent_runs (task_id);

alter table profiles enable row level security;
alter table note_groups enable row level security;
alter table tasks enable row level security;
alter table agent_runs enable row level security;

create policy "own profile" on profiles for all using (auth.uid() = id);
create policy "own note_groups" on note_groups for all using (auth.uid() = user_id);
create policy "own tasks" on tasks for all using (auth.uid() = user_id);
create policy "own agent_runs" on agent_runs for all using (auth.uid() = user_id);

-- Auto-create a profile row (with the free-beta entitlement) whenever a new user signs up.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
