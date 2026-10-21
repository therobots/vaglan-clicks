alter table public.photos
  add column if not exists thumbnail_url text;

insert into storage.buckets (id, name, public)
values
  ('private-originals', 'private-originals', false),
  ('public-previews', 'public-previews', true)
on conflict (id) do update
set name = excluded.name, public = excluded.public;

alter table private.photo_originals
  drop constraint if exists photo_originals_storage_bucket_valid;
alter table private.photo_originals
  add constraint photo_originals_storage_bucket_valid
  check (storage_bucket in ('photo-originals', 'originals', 'private-originals'));

alter table private.order_items
  drop constraint if exists order_items_original_bucket_valid;
alter table private.order_items
  add constraint order_items_original_bucket_valid
  check (original_bucket in ('photo-originals', 'originals', 'private-originals'));

drop policy if exists "photo originals are never directly accessible" on storage.objects;
create policy "photo originals are never directly accessible"
  on storage.objects as restrictive for all to anon, authenticated
  using (bucket_id not in ('photo-originals', 'originals', 'private-originals'))
  with check (bucket_id not in ('photo-originals', 'originals', 'private-originals'));

drop policy if exists "public cannot insert gallery preview objects" on storage.objects;
create policy "public cannot insert gallery preview objects" on storage.objects
  as restrictive for insert to anon, authenticated
  with check (bucket_id not in ('photos', 'previews', 'public-previews'));
drop policy if exists "public cannot update gallery preview objects" on storage.objects;
create policy "public cannot update gallery preview objects" on storage.objects
  as restrictive for update to anon, authenticated
  using (bucket_id not in ('photos', 'previews', 'public-previews'))
  with check (bucket_id not in ('photos', 'previews', 'public-previews'));
drop policy if exists "public cannot delete gallery preview objects" on storage.objects;
create policy "public cannot delete gallery preview objects" on storage.objects
  as restrictive for delete to anon, authenticated
  using (bucket_id not in ('photos', 'previews', 'public-previews'));

grant select (thumbnail_url) on public.photos to anon, authenticated;

drop function public.register_ingested_photo(uuid, text, text, bigint, text, text);
create function public.register_ingested_photo(
  photo_id_input uuid,
  preview_url_input text,
  thumbnail_url_input text,
  filename_input text,
  timestamp_input bigint,
  original_path_input text,
  original_bucket_input text
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
      or original_bucket_input not in ('originals', 'photo-originals', 'private-originals') then
    raise exception 'Invalid photo ingestion data' using errcode = '22023';
  end if;

  insert into public.photos (id, preview_url, thumbnail_url, filename, "timestamp")
  values (
    photo_id_input, preview_url_input, thumbnail_url_input, filename_input, timestamp_input
  );
  insert into private.photo_originals (photo_id, object_path, storage_bucket)
  values (photo_id_input, original_path_input, original_bucket_input);
  return photo_id_input;
end;
$$;

drop function public.gallery_photos(date, timestamptz, timestamptz, bigint, uuid, integer);
create function public.gallery_photos(
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

drop function public.gallery_purge_candidates(integer);
create function public.gallery_purge_candidates(limit_input integer default 500)
returns table (
  photo_id uuid,
  preview_url text,
  thumbnail_url text,
  preview_bucket text,
  original_path text,
  original_bucket text,
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
    photo.thumbnail_url,
    case
      when photo.preview_url like '%/object/public/public-previews/%'
        or photo.preview_url like '%/object/sign/public-previews/%' then 'public-previews'
      when photo.preview_url like '%/object/public/previews/%'
        or photo.preview_url like '%/object/sign/previews/%' then 'previews'
      else 'photos'
    end as preview_bucket,
    original.object_path as original_path,
    original.storage_bucket as original_bucket,
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

revoke all on function public.register_ingested_photo(uuid, text, text, text, bigint, text, text)
  from public, anon, authenticated;
revoke all on function public.gallery_photos(date, timestamptz, timestamptz, bigint, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.gallery_purge_candidates(integer)
  from public, anon, authenticated;
grant execute on function public.register_ingested_photo(uuid, text, text, text, bigint, text, text)
  to service_role;
grant execute on function public.gallery_photos(date, timestamptz, timestamptz, bigint, uuid, integer)
  to anon, authenticated;
grant execute on function public.gallery_purge_candidates(integer)
  to service_role;

notify pgrst, 'reload schema';
