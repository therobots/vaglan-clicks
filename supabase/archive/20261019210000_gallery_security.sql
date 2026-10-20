create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  event_date date,
  is_live boolean not null default true,
  expires_at timestamptz not null,
  price_per_photo numeric(10, 2) not null default 2.00 check (price_per_photo >= 0),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  preview_url text not null,
  filename text,
  "timestamp" timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists photos_event_time_idx
  on public.photos (event_id, "timestamp" desc);

create table if not exists public.sync_status (
  event_id uuid primary key references public.events(id) on delete cascade,
  last_heartbeat timestamptz,
  state text not null default 'idle' check (state in ('idle', 'uploading')),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id),
  photo_ids uuid[] not null check (cardinality(photo_ids) > 0),
  email text not null,
  subtotal numeric(10, 2) not null check (subtotal >= 0),
  tip numeric(10, 2) not null default 0 check (tip >= 0),
  amount_total numeric(10, 2) not null check (amount_total = subtotal + tip),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  stripe_session_id text unique,
  status text not null default 'pending' check (status in ('pending', 'paid', 'expired', 'refunded')),
  created_at timestamptz not null default now()
);

create table if not exists private.photo_originals (
  photo_id uuid primary key references public.photos(id) on delete cascade,
  object_path text not null unique
);

alter table public.events enable row level security;
alter table public.photos enable row level security;
alter table public.sync_status enable row level security;
alter table public.orders enable row level security;
alter table private.photo_originals enable row level security;

revoke all on public.events, public.photos, public.sync_status, public.orders
  from public, anon, authenticated;
revoke all on private.photo_originals from public, anon, authenticated;

grant select (id, slug, title, event_date, is_live, expires_at, price_per_photo, currency, created_at)
  on public.events to anon, authenticated;
grant select (id, event_id, preview_url, filename, "timestamp", created_at)
  on public.photos to anon, authenticated;
grant select (event_id, last_heartbeat, state, updated_at)
  on public.sync_status to anon, authenticated;

grant all on public.events, public.photos, public.sync_status, public.orders to service_role;
grant all on private.photo_originals to service_role;

drop policy if exists "public can read gallery events" on public.events;
create policy "public can read gallery events"
  on public.events for select to anon, authenticated
  using (true);

drop policy if exists "public can read live unexpired photo previews" on public.photos;
create policy "public can read live unexpired photo previews"
  on public.photos for select to anon, authenticated
  using (
    exists (
      select 1
      from public.events as event
      where event.id = photos.event_id
        and event.is_live
        and event.expires_at > now()
    )
  );

drop policy if exists "public can read live event sync status" on public.sync_status;
create policy "public can read live event sync status"
  on public.sync_status for select to anon, authenticated
  using (
    exists (
      select 1
      from public.events as event
      where event.id = sync_status.event_id
        and event.is_live
        and event.expires_at > now()
    )
  );

drop policy if exists "service role can access photo original paths" on private.photo_originals;
create policy "service role can access photo original paths"
  on private.photo_originals for all to service_role
  using (true)
  with check (true);

insert into storage.buckets (id, name, public)
values ('photo-originals', 'photo-originals', false)
on conflict (id) do update set public = false;

do $$
declare
  existing_policy record;
begin
  for existing_policy in
    select policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and (
        coalesce(qual, '') like '%photo-originals%'
        or coalesce(with_check, '') like '%photo-originals%'
      )
  loop
    execute format('drop policy %I on storage.objects', existing_policy.policyname);
  end loop;
end
$$;

drop policy if exists "photo originals are never directly accessible"
  on storage.objects;
create policy "photo originals are never directly accessible"
  on storage.objects as restrictive for all to anon, authenticated
  using (bucket_id <> 'photo-originals')
  with check (bucket_id <> 'photo-originals');

do $$
declare
  relation_name text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach relation_name in array array['events', 'photos'] loop
      if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = relation_name
      ) then
        execute format('alter publication supabase_realtime add table public.%I', relation_name);
      end if;
    end loop;
  end if;
end
$$;
