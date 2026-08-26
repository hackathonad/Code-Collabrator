-- Code Collaborator production auth and persistence schema.
-- The filename is retained for migration-history compatibility. The current
-- product is guest-first and never depends on Supabase Auth.

create table if not exists public.profiles (
  id uuid primary key,
  username text,
  display_name text,
  avatar_url text,
  email text,
  status text not null default 'offline' check (status in ('active', 'idle', 'offline')),
  theme text not null default 'aurora',
  preferences jsonb not null default '{}'::jsonb,
  profile_settings jsonb not null default '{}'::jsonb,
  last_room_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create table if not exists public.rooms (
  id text primary key check (id ~ '^[a-f0-9]{8}$'),
  owner_id uuid not null,
  language text not null default 'javascript' check (language in ('javascript', 'python', 'cpp')),
  code text not null default '',
  is_paused boolean not null default false,
  version integer not null default 1 check (version > 0),
  settings jsonb not null default '{}'::jsonb,
  participants jsonb not null default '[]'::jsonb,
  chat jsonb not null default '[]'::jsonb,
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.room_members (
  room_id text not null references public.rooms(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('owner', 'moderator', 'member', 'guest')),
  identity_kind text not null default 'member' check (identity_kind in ('guest', 'member')),
  username text,
  display_name text,
  avatar_url text,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz,
  is_online boolean not null default false,
  primary key (room_id, user_id)
);

create table if not exists public.room_history (
  id uuid primary key default gen_random_uuid(),
  room_id text not null references public.rooms(id) on delete cascade,
  room_version integer not null,
  language text not null check (language in ('javascript', 'python', 'cpp')),
  code text not null,
  reason text not null check (reason in ('initial', 'autosave', 'language-change', 'restart', 'restore', 'checkpoint')),
  created_by uuid,
  created_by_username text,
  created_at timestamptz not null default now()
);

create table if not exists public.user_preferences (
  user_id uuid primary key,
  theme text not null default 'aurora',
  preferences jsonb not null default '{}'::jsonb,
  profile_settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.recent_rooms (
  user_id uuid not null,
  room_id text not null references public.rooms(id) on delete cascade,
  label text,
  last_visited_at timestamptz not null default now(),
  primary key (user_id, room_id)
);

create index if not exists idx_rooms_owner_activity on public.rooms(owner_id, last_activity_at desc) where deleted_at is null;
create index if not exists idx_room_members_user on public.room_members(user_id, last_seen_at desc);
create index if not exists idx_room_history_room_created on public.room_history(room_id, created_at desc);
create index if not exists idx_recent_rooms_user_visited on public.recent_rooms(user_id, last_visited_at desc);

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.room_history enable row level security;
alter table public.user_preferences enable row level security;
alter table public.recent_rooms enable row level security;

-- RLS remains enabled and no browser role receives table access. The
-- server-only service-role client bypasses RLS for the persistence path.
revoke all on table public.profiles, public.rooms, public.room_members, public.room_history, public.user_preferences, public.recent_rooms from anon, authenticated;
