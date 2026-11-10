-- Code Collaborator M1: longer room IDs and the read-only "viewer" role.
--
-- Apply this BEFORE deploying a server build that issues 12-character room IDs
-- or lets an owner assign the viewer role. Until it is applied the database
-- rejects those rows; rooms keep working in memory but are not persisted.
-- (Setting ROOM_ID_BYTES=4 on the server keeps issuing 8-character IDs.)
--
-- Existing 8-character rooms remain valid.

do $$
declare
  existing record;
begin
  for existing in
    select rel.relname as table_name, con.conname as constraint_name
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and con.contype = 'c'
      and (
        (rel.relname = 'rooms' and pg_get_constraintdef(con.oid) like '%[a-f0-9]{8}%')
        or (rel.relname = 'room_members' and pg_get_constraintdef(con.oid) like '%moderator%')
      )
  loop
    execute format('alter table public.%I drop constraint %I', existing.table_name, existing.constraint_name);
  end loop;
end
$$;

alter table public.rooms
  add constraint rooms_id_format check (id ~ '^[a-f0-9]{8}([a-f0-9]{4})?$');

alter table public.room_members
  add constraint room_members_role_valid check (role in ('owner', 'moderator', 'member', 'guest', 'viewer'));
