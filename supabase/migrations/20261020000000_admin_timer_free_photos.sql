create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

alter table public.photos
  add column if not exists is_free boolean not null default false;

alter table public.photos alter column is_free set default false;
alter table public.photos
  add column if not exists created_at timestamptz not null default now();

grant select (id, preview_url, filename, "timestamp", is_free, created_at)
  on public.photos to anon, authenticated;

create table if not exists public.gallery_state (
  id integer primary key check (id = 1),
  timer_ends_at timestamptz
);

alter table public.gallery_state
  add column if not exists timer_ends_at timestamptz;

insert into public.gallery_state (id)
values (1)
on conflict (id) do nothing;

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

alter table public.gallery_state enable row level security;
revoke all on public.gallery_state from public, anon, authenticated;
grant select (id, timer_ends_at) on public.gallery_state to anon, authenticated;

drop policy if exists "public can read gallery timer" on public.gallery_state;
create policy "public can read gallery timer"
  on public.gallery_state for select to anon, authenticated
  using (id = 1);

create table if not exists private.gallery_admin_sessions (
  token_hash text primary key,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists private.gallery_admin_attempts (
  id bigint generated always as identity primary key,
  ip_address text not null,
  attempted_at timestamptz not null default now()
);

create table if not exists private.photo_originals (
  photo_id uuid primary key,
  object_path text not null unique
);

revoke all on private.gallery_admin_sessions, private.gallery_admin_attempts
  from public, anon, authenticated;
revoke all on private.gallery_admin_credentials from public, anon, authenticated;
revoke all on private.photo_originals from public, anon, authenticated;
grant all on private.gallery_admin_sessions, private.gallery_admin_attempts,
  private.gallery_admin_credentials, private.photo_originals to service_role;

alter table private.gallery_admin_sessions enable row level security;
alter table private.gallery_admin_attempts enable row level security;
alter table private.gallery_admin_credentials enable row level security;
alter table private.photo_originals enable row level security;

do $$
declare
  foreign_key_name text;
begin
  select constraint_name
  into foreign_key_name
  from information_schema.key_column_usage
  where table_schema = 'private'
    and table_name = 'photo_originals'
    and column_name = 'photo_id'
    and position_in_unique_constraint is not null
  limit 1;

  if foreign_key_name is not null then
    execute format('alter table private.photo_originals drop constraint %I', foreign_key_name);
  end if;
end
$$;

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

create or replace function public.start_gallery_timer()
returns timestamptz
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  new_timer_end timestamptz;
begin
  update public.gallery_state
  set timer_ends_at = now() + interval '48 hours'
  where id = 1
  returning timer_ends_at into new_timer_end;

  return new_timer_end;
end;
$$;

revoke all on function public.start_gallery_timer() from public, anon, authenticated;
grant execute on function public.start_gallery_timer() to service_role;

create or replace function public.reset_gallery_photos()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  deleted_count integer;
begin
  delete from public.photos;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.reset_gallery_photos() from public, anon, authenticated;
grant execute on function public.reset_gallery_photos() to service_role;

create or replace function public.count_gallery_admin_attempts(ip_input text, cutoff timestamptz)
returns integer
language sql
security definer
set search_path = pg_catalog, public, private
as $$
  select count(*)::integer
  from private.gallery_admin_attempts
  where ip_address = ip_input
    and attempted_at >= cutoff;
$$;

create or replace function public.record_gallery_admin_attempt(ip_input text)
returns void
language sql
security definer
set search_path = pg_catalog, public, private
as $$
  insert into private.gallery_admin_attempts (ip_address)
  values (ip_input);
$$;

create or replace function public.clear_gallery_admin_attempts(ip_input text, cutoff timestamptz default null)
returns void
language sql
security definer
set search_path = pg_catalog, public, private
as $$
  delete from private.gallery_admin_attempts
  where (ip_input is null or ip_address = ip_input)
    and (cutoff is null or attempted_at < cutoff);
$$;

create or replace function public.create_gallery_admin_session(hash_input text, expiry_input timestamptz)
returns void
language sql
security definer
set search_path = pg_catalog, public, private
as $$
  insert into private.gallery_admin_sessions (token_hash, expires_at)
  values (hash_input, expiry_input);
$$;

create or replace function public.validate_gallery_admin_session(hash_input text)
returns boolean
language sql
security definer
set search_path = pg_catalog, public, private
as $$
  select exists (
    select 1
    from private.gallery_admin_sessions
    where token_hash = hash_input
      and expires_at > now()
  );
$$;

create or replace function public.get_photo_original_path(photo_id_input uuid)
returns text
language sql
security definer
set search_path = pg_catalog, public, private
as $$
  select object_path
  from private.photo_originals
  where photo_id = photo_id_input;
$$;

create or replace function public.delete_photo_original_path(photo_id_input uuid)
returns void
language sql
security definer
set search_path = pg_catalog, public, private
as $$
  delete from private.photo_originals
  where photo_id = photo_id_input;
$$;

revoke all on function public.count_gallery_admin_attempts(text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.record_gallery_admin_attempt(text)
  from public, anon, authenticated;
revoke all on function public.clear_gallery_admin_attempts(text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.create_gallery_admin_session(text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.validate_gallery_admin_session(text)
  from public, anon, authenticated;
revoke all on function public.get_photo_original_path(uuid)
  from public, anon, authenticated;
revoke all on function public.delete_photo_original_path(uuid)
  from public, anon, authenticated;
grant execute on function public.count_gallery_admin_attempts(text, timestamptz) to service_role;
grant execute on function public.record_gallery_admin_attempt(text) to service_role;
grant execute on function public.clear_gallery_admin_attempts(text, timestamptz) to service_role;
grant execute on function public.create_gallery_admin_session(text, timestamptz) to service_role;
grant execute on function public.validate_gallery_admin_session(text) to service_role;
grant execute on function public.get_photo_original_path(uuid) to service_role;
grant execute on function public.delete_photo_original_path(uuid) to service_role;
