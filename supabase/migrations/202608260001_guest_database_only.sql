-- Guest-first transition for databases that already applied older migrations.
-- Preserve existing rows, but remove the unused legacy identity foreign keys
-- and RLS policies. The backend service-role client remains the only
-- database access path used by Code Collaborator.

do $$
declare
  constraint_row record;
  policy_row record;
begin
  for constraint_row in
    select n.nspname as schema_name, c.relname as table_name, con.conname as constraint_name
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and con.contype = 'f'
      and con.conname in (
        'profiles_id_fkey',
        'user_preferences_user_id_fkey',
        'recent_rooms_user_id_fkey',
        'github_connections_user_id_fkey',
        'analytics_events_user_id_fkey'
      )
  loop
    execute format(
      'alter table %I.%I drop constraint if exists %I',
      constraint_row.schema_name,
      constraint_row.table_name,
      constraint_row.constraint_name
    );
  end loop;

  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and policyname in (
        'profiles_select_own',
        'profiles_insert_own',
        'profiles_update_own',
        'rooms_select_membership_or_owner',
        'rooms_insert_own',
        'rooms_update_owner_or_moderator',
        'room_members_select_room_members',
        'room_members_insert_self_or_owner',
        'room_members_update_owner_or_self_presence',
        'room_history_select_members',
        'room_history_insert_members',
        'user_preferences_select_own',
        'user_preferences_insert_own',
        'user_preferences_update_own',
        'recent_rooms_select_own',
        'recent_rooms_insert_own',
        'recent_rooms_update_own',
        'recent_rooms_delete_own'
      )
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  end loop;
end
$$;
