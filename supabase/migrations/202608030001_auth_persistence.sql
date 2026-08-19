-- Code Collaborator production auth and persistence schema.
-- Idempotent migration for Supabase Auth-backed profiles, persistent rooms, membership, history, preferences, and recent rooms.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
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
  user_id uuid primary key references auth.users(id) on delete cascade,
  theme text not null default 'aurora',
  preferences jsonb not null default '{}'::jsonb,
  profile_settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.recent_rooms (
  user_id uuid not null references auth.users(id) on delete cascade,
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

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "rooms_select_membership_or_owner" on public.rooms;
drop policy if exists "rooms_insert_own" on public.rooms;
drop policy if exists "rooms_update_owner_or_moderator" on public.rooms;
drop policy if exists "room_members_select_room_members" on public.room_members;
drop policy if exists "room_members_insert_self_or_owner" on public.room_members;
drop policy if exists "room_members_update_owner_or_self_presence" on public.room_members;
drop policy if exists "room_history_select_members" on public.room_history;
drop policy if exists "room_history_insert_members" on public.room_history;
drop policy if exists "user_preferences_select_own" on public.user_preferences;
drop policy if exists "user_preferences_insert_own" on public.user_preferences;
drop policy if exists "user_preferences_update_own" on public.user_preferences;
drop policy if exists "recent_rooms_select_own" on public.recent_rooms;
drop policy if exists "recent_rooms_insert_own" on public.recent_rooms;
drop policy if exists "recent_rooms_update_own" on public.recent_rooms;
drop policy if exists "recent_rooms_delete_own" on public.recent_rooms;

create policy "profiles_select_own" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "profiles_insert_own" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy "profiles_update_own" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "rooms_select_membership_or_owner" on public.rooms for select to authenticated using (
  owner_id = (select auth.uid()) or exists (
    select 1 from public.room_members rm where rm.room_id = rooms.id and rm.user_id = (select auth.uid())
  )
);
create policy "rooms_insert_own" on public.rooms for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "rooms_update_owner_or_moderator" on public.rooms for update to authenticated using (
  owner_id = (select auth.uid()) or exists (
    select 1 from public.room_members rm where rm.room_id = rooms.id and rm.user_id = (select auth.uid()) and rm.role in ('owner', 'moderator')
  )
) with check (
  owner_id = (select auth.uid()) or exists (
    select 1 from public.room_members rm where rm.room_id = rooms.id and rm.user_id = (select auth.uid()) and rm.role in ('owner', 'moderator')
  )
);

create policy "room_members_select_room_members" on public.room_members for select to authenticated using (
  user_id = (select auth.uid()) or exists (
    select 1 from public.room_members self where self.room_id = room_members.room_id and self.user_id = (select auth.uid())
  )
);
create policy "room_members_insert_self_or_owner" on public.room_members for insert to authenticated with check (
  user_id = (select auth.uid()) or exists (
    select 1 from public.rooms r where r.id = room_members.room_id and r.owner_id = (select auth.uid())
  )
);
create policy "room_members_update_owner_or_self_presence" on public.room_members for update to authenticated using (
  user_id = (select auth.uid()) or exists (
    select 1 from public.rooms r where r.id = room_members.room_id and r.owner_id = (select auth.uid())
  )
) with check (
  user_id = (select auth.uid()) or exists (
    select 1 from public.rooms r where r.id = room_members.room_id and r.owner_id = (select auth.uid())
  )
);

create policy "room_history_select_members" on public.room_history for select to authenticated using (
  exists (select 1 from public.rooms r where r.id = room_history.room_id and r.owner_id = (select auth.uid()))
  or exists (select 1 from public.room_members rm where rm.room_id = room_history.room_id and rm.user_id = (select auth.uid()))
);
create policy "room_history_insert_members" on public.room_history for insert to authenticated with check (
  exists (select 1 from public.room_members rm where rm.room_id = room_history.room_id and rm.user_id = (select auth.uid()) and rm.role in ('owner', 'moderator', 'member'))
);

create policy "user_preferences_select_own" on public.user_preferences for select to authenticated using ((select auth.uid()) = user_id);
create policy "user_preferences_insert_own" on public.user_preferences for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "user_preferences_update_own" on public.user_preferences for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "recent_rooms_select_own" on public.recent_rooms for select to authenticated using ((select auth.uid()) = user_id);
create policy "recent_rooms_insert_own" on public.recent_rooms for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "recent_rooms_update_own" on public.recent_rooms for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "recent_rooms_delete_own" on public.recent_rooms for delete to authenticated using ((select auth.uid()) = user_id);
