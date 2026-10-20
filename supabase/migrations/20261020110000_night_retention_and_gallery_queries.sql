alter table public.gallery_state
  add column if not exists retention_hours integer not null default 48,
  add column if not exists paid_retention_days integer not null default 30,
  add column if not exists purge_enabled boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.gallery_state'::regclass
      and conname = 'gallery_state_retention_positive'
  ) then
    alter table public.gallery_state
      add constraint gallery_state_retention_positive
      check (retention_hours > 0 and paid_retention_days > 0);
  end if;
end
$$;

alter table public.photos
  add column if not exists expires_at timestamptz,
  add column if not exists is_hidden boolean not null default false;

create index if not exists photos_expires_at_idx
  on public.photos (expires_at);
create index if not exists photos_timestamp_desc_idx
  on public.photos ("timestamp" desc);

create or replace function public.gallery_capture_at(timestamp_input bigint)
returns timestamptz
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select case
    when timestamp_input < 100000000000
      then to_timestamp(timestamp_input::double precision)
    else to_timestamp(timestamp_input::double precision / 1000.0)
  end;
$$;

create or replace function public.gallery_night_key(timestamp_input bigint)
returns date
language sql
immutable
strict
set search_path = pg_catalog, public
as $$
  select (
  (
    public.gallery_capture_at(timestamp_input) - interval '12 hours'
  ) at time zone 'Europe/Athens'
)::date;
$$;

create or replace function public.gallery_night_expiry(
  timestamp_input bigint,
  retention_hours_input integer
)
returns timestamptz
language sql
immutable
strict
set search_path = pg_catalog, public
as $$
  select (
    (
      (public.gallery_night_key(timestamp_input) + 1)::timestamp
      + interval '12 hours'
    ) at time zone 'Europe/Athens'
  ) + make_interval(hours => retention_hours_input);
$$;

create or replace function public.set_gallery_photo_expiry()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  retention integer;
  capture_timestamp bigint;
begin
  select state.retention_hours
    into retention
    from public.gallery_state as state
    where state.id = 1;
  retention := coalesce(retention, 48);
  capture_timestamp := coalesce(
    new."timestamp",
    floor(extract(epoch from coalesce(new.created_at, now())) * 1000)::bigint
  );
  new.expires_at := public.gallery_night_expiry(capture_timestamp, retention);
  return new;
end;
$$;

drop trigger if exists set_gallery_photo_expiry on public.photos;
create trigger set_gallery_photo_expiry
  before insert on public.photos
  for each row execute function public.set_gallery_photo_expiry();

update public.photos as photo
set expires_at = greatest(
  public.gallery_night_expiry(
    coalesce(
      photo."timestamp",
      floor(extract(epoch from coalesce(photo.created_at, now())) * 1000)::bigint
    ),
    coalesce((select state.retention_hours from public.gallery_state as state where state.id = 1), 48)
  ),
  now() + interval '48 hours'
)
where photo.expires_at is null;

grant select (
  id, preview_url, filename, "timestamp", is_free, created_at, expires_at
)
  on public.photos to anon, authenticated;

drop policy if exists "public can read gallery photo previews" on public.photos;
create policy "public can read unhidden unexpired gallery previews"
  on public.photos for select to anon, authenticated
  using (
    coalesce(is_hidden, false) = false
    and expires_at > now()
  );

create or replace function public.gallery_server_now()
returns timestamptz
language sql
volatile
security definer
set search_path = pg_catalog
as $$
  select clock_timestamp();
$$;

create or replace function public.gallery_nights()
returns table (
  night_key date,
  photo_count bigint,
  first_timestamp bigint,
  last_timestamp bigint,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    public.gallery_night_key(photo."timestamp") as night_key,
    count(*) as photo_count,
    min(photo."timestamp") as first_timestamp,
    max(photo."timestamp") as last_timestamp,
    min(photo.expires_at) as expires_at
  from public.photos as photo
  where coalesce(photo.is_hidden, false) = false
    and photo.expires_at > now()
    and photo."timestamp" is not null
  group by public.gallery_night_key(photo."timestamp")
  order by night_key desc;
$$;

create or replace function public.gallery_slots(night_key_input date)
returns table (
  slot_start timestamptz,
  slot_end timestamptz,
  slot_minutes integer,
  photo_count bigint
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with visible_photos as (
    select
      public.gallery_capture_at(photo."timestamp") as captured_at,
      date_trunc(
        'hour',
        public.gallery_capture_at(photo."timestamp") at time zone 'Europe/Athens'
      ) as local_hour
    from public.photos as photo
    where coalesce(photo.is_hidden, false) = false
      and photo.expires_at > now()
      and photo."timestamp" is not null
      and public.gallery_night_key(photo."timestamp") = night_key_input
  ),
  hourly_counts as (
    select local_hour, count(*) as hour_count
    from visible_photos
    group by local_hour
  ),
  slotized as (
    select
      visible_photos.captured_at,
      case
        when hourly_counts.hour_count > 30 then 15
        when hourly_counts.hour_count > 10 then 30
        else 60
      end as slot_minutes
    from visible_photos
    join hourly_counts using (local_hour)
  ),
  grouped as (
    select
      to_timestamp(
        (
          floor(extract(epoch from captured_at) / (slot_minutes * 60))
            * (slot_minutes * 60)
        )::double precision
      ) as slot_start,
      slot_minutes,
      count(*) as photo_count
    from slotized
    group by 1, slot_minutes
  )
  select
    grouped.slot_start,
    grouped.slot_start + make_interval(mins => grouped.slot_minutes),
    grouped.slot_minutes,
    grouped.photo_count
  from grouped
  order by grouped.slot_start desc;
$$;

create or replace function public.gallery_photos(
  night_key_input date,
  slot_start_input timestamptz default null,
  slot_end_input timestamptz default null,
  before_timestamp_input bigint default null,
  before_photo_id_input uuid default null,
  limit_input integer default 60
)
returns table (
  id uuid,
  preview_url text,
  filename text,
  "timestamp" bigint,
  is_free boolean,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    photo.id,
    photo.preview_url,
    photo.filename,
    photo."timestamp",
    coalesce(photo.is_free, false),
    photo.expires_at
  from public.photos as photo
  where coalesce(photo.is_hidden, false) = false
    and photo.expires_at > now()
    and photo."timestamp" is not null
    and public.gallery_night_key(photo."timestamp") = night_key_input
    and (
      slot_start_input is null
      or (
        public.gallery_capture_at(photo."timestamp") >= slot_start_input
        and public.gallery_capture_at(photo."timestamp") < slot_end_input
      )
    )
    and (
      before_timestamp_input is null
      or photo."timestamp" < before_timestamp_input
      or (
        photo."timestamp" = before_timestamp_input
        and (before_photo_id_input is null or photo.id < before_photo_id_input)
      )
    )
  order by photo."timestamp" desc, photo.id desc
  limit greatest(1, least(coalesce(limit_input, 60), 100));
$$;

create or replace function public.create_pending_photo_order(
  photo_ids_input uuid[],
  tip_cents_input integer default 0
)
returns table (
  order_id uuid,
  first_photo_cents integer,
  extra_photo_cents integer,
  photo_count integer,
  subtotal_cents bigint,
  tip_cents integer,
  total_cents bigint,
  currency text
)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  unique_photo_count integer;
  available_photo_count integer;
  original_count integer;
  first_price integer;
  extra_price integer;
  allowed_tips integer[];
  order_currency text;
  subtotal_amount bigint;
  total_amount bigint;
  new_order_id uuid;
begin
  if photo_ids_input is null or cardinality(photo_ids_input) < 1
      or cardinality(photo_ids_input) > 100 then
    raise exception 'Select between 1 and 100 photos' using errcode = '22023';
  end if;
  photo_count := cardinality(photo_ids_input);
  select count(distinct selected.photo_id)::integer
    into unique_photo_count
    from unnest(photo_ids_input) as selected(photo_id);
  if unique_photo_count <> photo_count then
    raise exception 'Duplicate photo IDs are not allowed' using errcode = '22023';
  end if;
  if tip_cents_input is null then
    raise exception 'Choose a valid tip amount' using errcode = '22023';
  end if;

  select
    state.first_photo_cents,
    state.extra_photo_cents,
    state.tip_options_cents,
    state.currency
    into first_price, extra_price, allowed_tips, order_currency
    from public.gallery_state as state
    where state.id = 1;
  if not found then
    raise exception 'Gallery settings are unavailable' using errcode = 'P0001';
  end if;
  if not tip_cents_input = any(allowed_tips) then
    raise exception 'Choose one of the available tip amounts' using errcode = '22023';
  end if;

  select count(*)::integer
    into available_photo_count
    from public.photos as photo
    where photo.id = any(photo_ids_input)
      and not coalesce(photo.is_free, false)
      and not coalesce(photo.is_hidden, false)
      and photo.expires_at > now();
  if available_photo_count <> photo_count then
    raise exception 'One or more selected photos are unavailable or expired' using errcode = 'P0001';
  end if;

  select count(*)::integer
    into original_count
    from private.photo_originals as original
    where original.photo_id = any(photo_ids_input);
  if original_count <> photo_count then
    raise exception 'One or more original photos are unavailable' using errcode = 'P0001';
  end if;

  subtotal_amount := first_price::bigint + extra_price::bigint * (photo_count - 1);
  total_amount := subtotal_amount + tip_cents_input;

  insert into private.orders (subtotal_cents, tip_cents, total_cents, currency)
  values (subtotal_amount, tip_cents_input, total_amount, order_currency)
  returning id into new_order_id;

  insert into private.order_items (
    order_id, photo_id, unit_amount_cents, original_path, preview_url, filename
  )
  select
    new_order_id,
    photo.id,
    case when selected.ordinality = 1 then first_price else extra_price end,
    original.object_path,
    photo.preview_url,
    coalesce(nullif(photo.filename, ''), photo.id::text || '.jpg')
  from unnest(photo_ids_input) with ordinality as selected(photo_id, ordinality)
  join public.photos as photo on photo.id = selected.photo_id
  join private.photo_originals as original on original.photo_id = photo.id
  where not coalesce(photo.is_free, false)
    and not coalesce(photo.is_hidden, false)
    and photo.expires_at > now();

  return query
    select
      new_order_id,
      first_price,
      extra_price,
      photo_count,
      subtotal_amount,
      tip_cents_input,
      total_amount,
      order_currency;
end;
$$;

create or replace function public.gallery_purge_candidates(limit_input integer default 500)
returns table (
  photo_id uuid,
  preview_url text,
  original_path text,
  delete_original boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select
    photo.id as photo_id,
    photo.preview_url,
    original.object_path as original_path,
    original.object_path is not null
      and coalesce(paid.latest_paid_at, '-infinity'::timestamptz)
          + make_interval(days => state.paid_retention_days) <= now() as delete_original
  from public.photos as photo
  cross join public.gallery_state as state
  left join private.photo_originals as original on original.photo_id = photo.id
  left join lateral (
    select max(order_record.paid_at) as latest_paid_at
    from private.order_items as item
    join private.orders as order_record on order_record.id = item.order_id
    where item.photo_id = photo.id
      and order_record.paid_at is not null
  ) as paid on true
  where state.id = 1
    and photo.expires_at <= now()
    and not exists (
      select 1
      from private.order_items as item
      join private.orders as order_record on order_record.id = item.order_id
      where item.photo_id = photo.id
        and order_record.status = 'pending'
        and order_record.created_at > now() - interval '35 minutes'
    )
  order by photo.expires_at, photo.id
  limit greatest(1, least(coalesce(limit_input, 500), 1000));
$$;

create or replace function public.gallery_finalize_purge(photo_ids_input uuid[])
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  deleted_count integer;
begin
  if photo_ids_input is null or cardinality(photo_ids_input) = 0 then
    return 0;
  end if;
  with deleted_photos as (
    delete from public.photos
    where id = any(photo_ids_input)
      and expires_at <= now()
    returning id
  ),
  deleted_original_maps as (
    delete from private.photo_originals as original
    using deleted_photos
    where original.photo_id = deleted_photos.id
    returning original.photo_id
  )
  select count(*)::integer into deleted_count
  from deleted_photos;
  return deleted_count;
end;
$$;

revoke all on function public.gallery_capture_at(bigint) from public, anon, authenticated;
revoke all on function public.gallery_night_key(bigint) from public, anon, authenticated;
revoke all on function public.gallery_night_expiry(bigint, integer) from public, anon, authenticated;
revoke all on function public.set_gallery_photo_expiry() from public, anon, authenticated;
revoke all on function public.gallery_server_now() from public, anon, authenticated;
revoke all on function public.gallery_nights() from public, anon, authenticated;
revoke all on function public.gallery_slots(date) from public, anon, authenticated;
revoke all on function public.gallery_photos(date, timestamptz, timestamptz, bigint, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.create_pending_photo_order(uuid[], integer)
  from public, anon, authenticated;
revoke all on function public.gallery_purge_candidates(integer)
  from public, anon, authenticated;
revoke all on function public.gallery_finalize_purge(uuid[])
  from public, anon, authenticated;
grant execute on function public.gallery_server_now() to anon, authenticated;
grant execute on function public.gallery_nights() to anon, authenticated;
grant execute on function public.gallery_slots(date) to anon, authenticated;
grant execute on function public.gallery_photos(date, timestamptz, timestamptz, bigint, uuid, integer)
  to anon, authenticated;
grant execute on function public.gallery_night_key(bigint) to service_role;
grant execute on function public.create_pending_photo_order(uuid[], integer) to service_role;
grant execute on function public.gallery_purge_candidates(integer) to service_role;
grant execute on function public.gallery_finalize_purge(uuid[]) to service_role;

notify pgrst, 'reload schema';
