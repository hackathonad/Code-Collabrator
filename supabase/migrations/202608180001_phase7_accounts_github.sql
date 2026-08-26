-- Legacy server-managed metadata fields and encrypted GitHub connections.
-- Code Collaborator no longer uses Supabase Auth; identities are guest UUIDs.
alter table public.profiles add column if not exists bio text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_bio_length') then
    alter table public.profiles add constraint profiles_bio_length check (bio is null or char_length(bio) <= 280);
  end if;
end $$;

create unique index if not exists profiles_username_lower_unique
  on public.profiles (lower(username)) where username is not null;

create table if not exists public.github_connections (
  user_id uuid primary key,
  github_id text not null unique,
  github_login text not null,
  avatar_url text,
  access_token_ciphertext text not null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.github_connections enable row level security;
-- Browser clients do not receive GitHub credential rows. The server service-role
-- client is the only component permitted to read or write these connections.
revoke all on table public.github_connections from anon, authenticated;
