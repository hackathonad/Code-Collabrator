-- Code Collaborator M1: durable AI teammate state.
--
-- Tasks, patch proposals and project memory used to live only in server memory
-- and vanished on every restart or deploy. The server now writes them through
-- to these tables and restores them when a room is loaded.
--
-- Guest-first: there is no auth schema here. Rows are keyed by room and written
-- only by the server's service-role client; browser roles get no access.
-- Retention: the server keeps the 40 most recent tasks and 100 most recent
-- proposals per room and prunes the rest.

create table if not exists public.ai_tasks (
  room_id text not null references public.rooms(id) on delete cascade,
  task_id text not null,
  user_id text not null,
  status text not null,
  mode text not null,
  intent text not null,
  priority text not null default 'normal',
  summary text not null default '',
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_id, task_id)
);

create table if not exists public.patch_proposals (
  room_id text not null references public.rooms(id) on delete cascade,
  patch_id text not null,
  task_id text,
  user_id text not null,
  status text not null,
  base_version integer not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_id, patch_id)
);

create table if not exists public.project_memory (
  room_id text primary key references public.rooms(id) on delete cascade,
  memory jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_ai_tasks_room_created on public.ai_tasks (room_id, created_at desc);
create index if not exists idx_ai_tasks_room_status on public.ai_tasks (room_id, status);
create index if not exists idx_patch_proposals_room_updated on public.patch_proposals (room_id, updated_at desc);
create index if not exists idx_patch_proposals_task on public.patch_proposals (room_id, task_id) where task_id is not null;

alter table public.ai_tasks enable row level security;
alter table public.patch_proposals enable row level security;
alter table public.project_memory enable row level security;

-- RLS stays enabled with no policies, and browser roles receive no table access.
revoke all on table public.ai_tasks, public.patch_proposals, public.project_memory from anon, authenticated;
