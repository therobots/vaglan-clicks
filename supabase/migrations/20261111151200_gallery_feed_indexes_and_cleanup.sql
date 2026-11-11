alter table public.photos
  add column if not exists captured_at timestamptz,
  add column if not exists night_key date;

create or replace function public.set_gallery_photo_capture_columns()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new."timestamp" is null then
    new.captured_at := null;
    new.night_key := null;
  else
    new.captured_at := public.gallery_capture_at(new."timestamp");
    new.night_key := public.gallery_night_key(new."timestamp");
  end if;
  return new;
end;
$$;

revoke all on function public.set_gallery_photo_capture_columns()
  from public, anon, authenticated;

drop trigger if exists set_gallery_photo_capture_columns on public.photos;
create trigger set_gallery_photo_capture_columns
  before insert or update of "timestamp", captured_at, night_key on public.photos
  for each row execute function public.set_gallery_photo_capture_columns();

update public.photos as photo
set captured_at = public.gallery_capture_at(photo."timestamp"),
    night_key = public.gallery_night_key(photo."timestamp")
where photo.captured_at is distinct from public.gallery_capture_at(photo."timestamp")
   or photo.night_key is distinct from public.gallery_night_key(photo."timestamp");

create index if not exists photos_feed_idx
  on public.photos (album_id, night_key, "timestamp" desc, id desc)
  where coalesce(is_hidden, false) = false
    and coalesce(watermark_baked, false)
    and "timestamp" is not null
    and night_key is not null;

drop index if exists public.photos_album_id_idx;

create index if not exists gallery_admin_attempts_ip_time_idx
  on private.gallery_admin_attempts (ip_address, attempted_at desc);
create index if not exists viva_events_received_at_idx
  on private.viva_events (received_at);
create index if not exists stripe_events_processed_at_idx
  on private.stripe_events (processed_at);
create index if not exists gallery_admin_sessions_expires_at_idx
  on private.gallery_admin_sessions (expires_at);
create index if not exists orders_pending_created_at_idx
  on private.orders (created_at, id)
  where status = 'pending';

create or replace function public.gallery_nights(album_id_input text default 'general')
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
    photo.night_key,
    count(*) as photo_count,
    min(photo."timestamp") as first_timestamp,
    max(photo."timestamp") as last_timestamp,
    min(photo.expires_at) as expires_at
  from public.photos as photo
  where coalesce(photo.is_hidden, false) = false
    and photo.expires_at > now()
    and photo."timestamp" is not null
    and photo.night_key is not null
    and photo.album_id = coalesce(nullif(album_id_input, ''), 'general')
    and coalesce(photo.watermark_baked, false)
  group by photo.night_key
  order by photo.night_key desc;
$$;

create or replace function public.gallery_slots(
  album_id_input text,
  night_key_input date
)
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
      photo.captured_at,
      date_trunc(
        'hour',
        photo.captured_at at time zone 'Europe/Athens'
      ) as local_hour
    from public.photos as photo
    where coalesce(photo.is_hidden, false) = false
      and photo.expires_at > now()
      and photo.captured_at is not null
      and photo.night_key = night_key_input
      and photo.album_id = coalesce(nullif(album_id_input, ''), 'general')
      and coalesce(photo.watermark_baked, false)
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

drop function if exists public.gallery_photos(
  text, date, timestamptz, timestamptz, bigint, uuid, integer
);
create function public.gallery_photos(
  album_id_input text default 'general',
  night_key_input date default null,
  slot_start_input timestamptz default null,
  slot_end_input timestamptz default null,
  before_timestamp_input bigint default null,
  before_photo_id_input uuid default null,
  limit_input integer default 60,
  after_timestamp_input bigint default null,
  after_photo_id_input uuid default null
)
returns table (
  id uuid,
  preview_url text,
  thumbnail_url text,
  filename text,
  "timestamp" bigint,
  is_free boolean,
  expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if night_key_input is null then
    raise exception 'A gallery night is required' using errcode = '22023';
  end if;
  if (before_timestamp_input is null) <> (before_photo_id_input is null)
      or (after_timestamp_input is null) <> (after_photo_id_input is null) then
    raise exception 'Both timestamp and photo ID are required for a cursor'
      using errcode = '22023';
  end if;
  if before_timestamp_input is not null and after_timestamp_input is not null then
    raise exception 'Use either an after or before cursor, not both'
      using errcode = '22023';
  end if;
  if (slot_start_input is null) <> (slot_end_input is null) then
    raise exception 'Both slot boundaries are required' using errcode = '22023';
  end if;

  return query
    select
      photo.id,
      photo.preview_url,
      photo.thumbnail_url,
      photo.filename,
      photo."timestamp",
      coalesce(photo.is_free, false),
      photo.expires_at
    from public.photos as photo
    where coalesce(photo.is_hidden, false) = false
      and photo.expires_at > now()
      and photo."timestamp" is not null
      and photo.night_key = night_key_input
      and photo.album_id = coalesce(nullif(album_id_input, ''), 'general')
      and coalesce(photo.watermark_baked, false)
      and (
        slot_start_input is null
        or (
          photo.captured_at >= slot_start_input
          and photo.captured_at < slot_end_input
        )
      )
      and (
        before_timestamp_input is null
        or (photo."timestamp", photo.id) < (before_timestamp_input, before_photo_id_input)
      )
      and (
        after_timestamp_input is null
        or (photo."timestamp", photo.id) > (after_timestamp_input, after_photo_id_input)
      )
    order by photo."timestamp" desc, photo.id desc
    limit greatest(1, least(coalesce(limit_input, 60), 100));
end;
$$;

revoke all on function public.gallery_nights(text)
  from public, anon, authenticated;
revoke all on function public.gallery_slots(text, date)
  from public, anon, authenticated;
revoke all on function public.gallery_photos(
  text, date, timestamptz, timestamptz, bigint, uuid, integer, bigint, uuid
) from public, anon, authenticated;
grant execute on function public.gallery_nights(text) to anon, authenticated;
grant execute on function public.gallery_slots(text, date) to anon, authenticated;
grant execute on function public.gallery_photos(
  text, date, timestamptz, timestamptz, bigint, uuid, integer, bigint, uuid
) to anon, authenticated;

create or replace function public.consume_order_download_attempt(
  ip_input text,
  window_seconds_input integer,
  max_attempts_input integer
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
declare
  attempts integer;
  client_ip text := coalesce(nullif(ip_input, ''), 'unknown');
begin
  if window_seconds_input < 1 or max_attempts_input < 1 then
    raise exception 'Invalid rate limit parameters' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(client_ip, 0));
  select count(*)::integer into attempts
  from private.order_download_attempts
  where ip_address = client_ip
    and attempted_at >= now() - make_interval(secs => window_seconds_input);
  if attempts >= max_attempts_input then
    return false;
  end if;
  insert into private.order_download_attempts (ip_address) values (client_ip);
  return true;
end;
$$;

revoke all on function public.consume_order_download_attempt(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_order_download_attempt(text, integer, integer)
  to service_role;

create or replace function private.cleanup_gallery_operational_data()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
declare
  download_attempts_deleted integer;
  admin_attempts_deleted integer;
  admin_sessions_deleted integer;
  viva_events_deleted integer;
  stripe_events_deleted integer;
  pending_orders_expired integer;
begin
  delete from private.order_download_attempts
  where ctid in (
    select ctid
    from private.order_download_attempts
    where attempted_at < now() - interval '24 hours'
    order by attempted_at
    limit 10000
  );
  get diagnostics download_attempts_deleted = row_count;

  delete from private.gallery_admin_attempts
  where ctid in (
    select ctid
    from private.gallery_admin_attempts
    where attempted_at < now() - interval '24 hours'
    order by attempted_at
    limit 10000
  );
  get diagnostics admin_attempts_deleted = row_count;

  delete from private.gallery_admin_sessions
  where ctid in (
    select ctid
    from private.gallery_admin_sessions
    where expires_at <= now()
    order by expires_at
    limit 10000
  );
  get diagnostics admin_sessions_deleted = row_count;

  delete from private.viva_events
  where ctid in (
    select ctid
    from private.viva_events
    where received_at < now() - interval '90 days'
    order by received_at
    limit 10000
  );
  get diagnostics viva_events_deleted = row_count;

  delete from private.stripe_events
  where ctid in (
    select ctid
    from private.stripe_events
    where processed_at < now() - interval '90 days'
    order by processed_at
    limit 10000
  );
  get diagnostics stripe_events_deleted = row_count;

  with stale_orders as (
    select order_record.id
    from private.orders as order_record
    where order_record.status = 'pending'
      and order_record.created_at < now() - interval '35 minutes'
    order by order_record.created_at
    for update skip locked
    limit 1000
  )
  update private.orders as order_record
  set status = 'expired'
  from stale_orders
  where order_record.id = stale_orders.id;
  get diagnostics pending_orders_expired = row_count;

  return jsonb_build_object(
    'download_attempts_deleted', download_attempts_deleted,
    'admin_attempts_deleted', admin_attempts_deleted,
    'admin_sessions_deleted', admin_sessions_deleted,
    'viva_events_deleted', viva_events_deleted,
    'stripe_events_deleted', stripe_events_deleted,
    'pending_orders_expired', pending_orders_expired
  );
end;
$$;

revoke all on function private.cleanup_gallery_operational_data()
  from public, anon, authenticated;
grant execute on function private.cleanup_gallery_operational_data()
  to service_role;

notify pgrst, 'reload schema';
