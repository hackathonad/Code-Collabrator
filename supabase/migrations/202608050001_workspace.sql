-- Phase 3: durable multi-file workspace snapshots.
-- Realtime editor updates remain on Socket.IO; this column stores recoverable workspace state.
alter table public.rooms add column if not exists workspace jsonb;
update public.rooms set workspace = '{}'::jsonb where workspace is null;
create index if not exists idx_rooms_workspace_gin on public.rooms using gin (workspace jsonb_path_ops);
