create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

alter table public.photos
  add column if not exists is_free boolean not null default false,
  add column if not exists created_at timestamptz not null default now();
alter table public.photos alter column is_free set default false;

create table if not exists public.gallery_state (
  id integer primary key check (id = 1),
  timer_ends_at timestamptz
);
alter table public.gallery_state
  add column if not exists timer_ends_at timestamptz;
insert into public.gallery_state (id) values (1) on conflict (id) do nothing;

create table if not exists private.gallery_admin_credentials (
  id integer primary key check (id = 1),
  pin_hash text not null
);
alter table private.gallery_admin_credentials enable row level security;
revoke all on private.gallery_admin_credentials from public, anon, authenticated;
grant all on private.gallery_admin_credentials to service_role;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'gallery_state'
      and column_name = 'admin_pin'
  ) then
    execute $migration$
      insert into private.gallery_admin_credentials (id, pin_hash)
      select id::integer, admin_pin
      from public.gallery_state
      where id = 1 and admin_pin is not null
      on conflict (id) do nothing
    $migration$;
    alter table public.gallery_state drop column admin_pin;
  end if;
end
$$;

do $$
declare
  current_column text;
begin
  for current_column in
    select columns.column_name
    from information_schema.columns as columns
    where columns.table_schema = 'public'
      and columns.table_name = 'gallery_state'
  loop
    execute format(
      'revoke all (%I) on table public.gallery_state from public, anon, authenticated',
      current_column
    );
  end loop;
end
$$;

alter table public.gallery_state enable row level security;
revoke all on public.gallery_state from public, anon, authenticated;
grant select (id, timer_ends_at) on public.gallery_state to anon, authenticated;

do $$
declare
  existing_policy record;
begin
  for existing_policy in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'gallery_state'
  loop
    execute format('drop policy %I on public.gallery_state', existing_policy.policyname);
  end loop;
end
$$;

create policy "public can read gallery timer"
  on public.gallery_state for select to anon, authenticated
  using (id = 1);

do $$
declare
  current_column text;
begin
  for current_column in
    select columns.column_name
    from information_schema.columns as columns
    where columns.table_schema = 'public'
      and columns.table_name = 'photos'
  loop
    execute format(
      'revoke all (%I) on table public.photos from public, anon, authenticated',
      current_column
    );
  end loop;
end
$$;

alter table public.photos enable row level security;
revoke all on public.photos from public, anon, authenticated;
grant select (id, preview_url, filename, "timestamp", is_free, created_at)
  on public.photos to anon, authenticated;

do $$
declare
  existing_policy record;
begin
  for existing_policy in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'photos'
  loop
    execute format('drop policy %I on public.photos', existing_policy.policyname);
  end loop;
end
$$;

create policy "public can read gallery photo previews"
  on public.photos for select to anon, authenticated
  using (true);

grant all on private.gallery_admin_sessions, private.gallery_admin_attempts,
  private.gallery_admin_credentials, private.photo_originals to service_role;
revoke all on private.gallery_admin_sessions, private.gallery_admin_attempts,
  private.gallery_admin_credentials, private.photo_originals
  from public, anon, authenticated;
alter table private.gallery_admin_sessions enable row level security;
alter table private.gallery_admin_attempts enable row level security;
alter table private.photo_originals enable row level security;
alter table private.gallery_admin_credentials enable row level security;

create or replace function public.verify_gallery_admin_pin(pin_input text)
returns boolean
language sql
security definer
set search_path = pg_catalog, public, extensions
as $$
  select coalesce((
    select pin_hash = crypt(pin_input, pin_hash)
    from private.gallery_admin_credentials
    where id = 1
  ), false);
$$;
revoke all on function public.verify_gallery_admin_pin(text) from public, anon, authenticated;
grant execute on function public.verify_gallery_admin_pin(text) to service_role;

revoke insert, update, delete on storage.objects from public, anon, authenticated;

do $$
declare
  existing_policy record;
begin
  for existing_policy in
    select policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      and roles && array['public', 'anon', 'authenticated']::name[]
  loop
    execute format('drop policy %I on storage.objects', existing_policy.policyname);
  end loop;
end
$$;

drop policy if exists "photo originals are never directly accessible" on storage.objects;
create policy "photo originals are never directly accessible"
  on storage.objects as restrictive for all to anon, authenticated
  using (bucket_id <> 'photo-originals')
  with check (bucket_id <> 'photo-originals');

drop policy if exists "public cannot insert photos bucket objects" on storage.objects;
create policy "public cannot insert photos bucket objects"
  on storage.objects as restrictive for insert to anon, authenticated
  with check (bucket_id <> 'photos');

drop policy if exists "public cannot update photos bucket objects" on storage.objects;
create policy "public cannot update photos bucket objects"
  on storage.objects as restrictive for update to anon, authenticated
  using (bucket_id <> 'photos')
  with check (bucket_id <> 'photos');

drop policy if exists "public cannot delete photos bucket objects" on storage.objects;
create policy "public cannot delete photos bucket objects"
  on storage.objects as restrictive for delete to anon, authenticated
  using (bucket_id <> 'photos');

update storage.buckets set public = false where id = 'photo-originals';

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'photos'
    )
  then
    alter publication supabase_realtime add table public.photos;
  end if;
end
$$;

notify pgrst, 'reload schema';
