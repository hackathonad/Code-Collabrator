-- Phase 8: private, metadata-only user analytics. Browser roles have no direct
-- table access; the server service-role client writes validated event payloads.
create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in (
    'room_created', 'room_joined', 'room_left', 'workspace_opened', 'file_created', 'file_deleted',
    'execution_started', 'execution_completed', 'execution_failed', 'ai_request', 'ai_request_completed',
    'ai_request_failed', 'git_commit', 'git_push', 'git_pull', 'github_repository_imported',
    'media_call_joined', 'media_call_left', 'screen_share_started', 'screen_share_stopped'
  )),
  user_id uuid not null,
  room_id text,
  workspace_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_user_created_at_idx on public.analytics_events (user_id, created_at desc);
create index if not exists analytics_events_room_created_at_idx on public.analytics_events (room_id, created_at desc) where room_id is not null;
create index if not exists analytics_events_workspace_created_at_idx on public.analytics_events (workspace_id, created_at desc) where workspace_id is not null;
create index if not exists analytics_events_type_created_at_idx on public.analytics_events (event_type, created_at desc);

alter table public.analytics_events enable row level security;
revoke all on table public.analytics_events from anon, authenticated;

comment on table public.analytics_events is 'Validated product activity metadata only. Retain raw events for 90 days through an external scheduled server job; never apply this retention to rooms, workspaces, chat, project data, or AI conversation history.';
