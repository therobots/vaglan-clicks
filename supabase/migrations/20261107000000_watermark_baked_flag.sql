alter table public.photos
  add column if not exists watermark_baked boolean not null default false;

update public.photos
set watermark_baked = true
where preview_url like '%/public-previews/%'
  and thumbnail_url is not null;

create or replace function public.register_ingested_photo(
  photo_id_input uuid,
  preview_url_input text,
  thumbnail_url_input text,
  filename_input text,
  timestamp_input bigint,
  original_path_input text,
  original_bucket_input text,
  album_id_input text default 'general'
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if photo_id_input is null
      or timestamp_input is null
      or timestamp_input <= 0
      or nullif(preview_url_input, '') is null
      or nullif(thumbnail_url_input, '') is null
      or nullif(filename_input, '') is null
      or nullif(original_path_input, '') is null
      or original_bucket_input not in ('originals', 'photo-originals', 'private-originals')
      or nullif(album_id_input, '') is null then
    raise exception 'Invalid photo ingestion data' using errcode = '22023';
  end if;

  insert into public.photos (
    id, preview_url, thumbnail_url, filename, "timestamp", album_id, watermark_baked
  )
  values (
    photo_id_input,
    preview_url_input,
    thumbnail_url_input,
    filename_input,
    timestamp_input,
    case when album_id_input ~ '^[A-Za-z0-9_-]{1,64}$' then album_id_input else 'general' end,
    true
  );

  insert into private.photo_originals (photo_id, object_path, storage_bucket)
  values (photo_id_input, original_path_input, original_bucket_input);
  return photo_id_input;
end;
$$;

create or replace function public.attach_photo_original(
  photo_id_input uuid,
  original_path_input text,
  original_bucket_input text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if photo_id_input is null
      or nullif(original_path_input, '') is null
      or original_bucket_input <> 'private-originals' then
    raise exception 'Invalid private original attachment' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.photos where id = photo_id_input
  ) then
    raise exception 'Photo was not found' using errcode = 'P0002';
  end if;

  insert into private.photo_originals (photo_id, object_path, storage_bucket)
  values (photo_id_input, original_path_input, original_bucket_input)
  on conflict (photo_id) do update
    set object_path = excluded.object_path,
        storage_bucket = excluded.storage_bucket;

  return true;
end;
$$;

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
    public.gallery_night_key(photo."timestamp") as night_key,
    count(*) as photo_count,
    min(photo."timestamp") as first_timestamp,
    max(photo."timestamp") as last_timestamp,
    min(photo.expires_at) as expires_at
  from public.photos as photo
  where coalesce(photo.is_hidden, false) = false
    and photo.expires_at > now()
    and photo."timestamp" is not null
    and photo.album_id = coalesce(nullif(album_id_input, ''), 'general')
    and coalesce(photo.watermark_baked, false)
  group by public.gallery_night_key(photo."timestamp")
  order by night_key desc;
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
      public.gallery_capture_at(photo."timestamp") as captured_at,
      date_trunc(
        'hour',
        public.gallery_capture_at(photo."timestamp") at time zone 'Europe/Athens'
      ) as local_hour
    from public.photos as photo
    where coalesce(photo.is_hidden, false) = false
      and photo.expires_at > now()
      and photo."timestamp" is not null
      and photo.album_id = coalesce(nullif(album_id_input, ''), 'general')
      and coalesce(photo.watermark_baked, false)
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
  album_id_input text default 'general',
  night_key_input date default null,
  slot_start_input timestamptz default null,
  slot_end_input timestamptz default null,
  before_timestamp_input bigint default null,
  before_photo_id_input uuid default null,
  limit_input integer default 60
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
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
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
    and photo.album_id = coalesce(nullif(album_id_input, ''), 'general')
    and coalesce(photo.watermark_baked, false)
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

revoke all on function public.register_ingested_photo(uuid, text, text, text, bigint, text, text, text)
  from public, anon, authenticated;
revoke all on function public.attach_photo_original(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.gallery_nights(text)
  from public, anon, authenticated;
revoke all on function public.gallery_slots(text, date)
  from public, anon, authenticated;
revoke all on function public.gallery_photos(text, date, timestamptz, timestamptz, bigint, uuid, integer)
  from public, anon, authenticated;

grant execute on function public.register_ingested_photo(uuid, text, text, text, bigint, text, text, text)
  to service_role;
grant execute on function public.attach_photo_original(uuid, text, text)
  to service_role;
grant execute on function public.gallery_nights(text)
  to anon, authenticated;
grant execute on function public.gallery_slots(text, date)
  to anon, authenticated;
grant execute on function public.gallery_photos(text, date, timestamptz, timestamptz, bigint, uuid, integer)
  to anon, authenticated;

notify pgrst, 'reload schema';
