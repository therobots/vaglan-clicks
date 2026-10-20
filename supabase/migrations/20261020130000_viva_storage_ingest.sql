create table if not exists private.viva_events (
  id text primary key,
  received_at timestamptz not null default now()
);
alter table private.viva_events enable row level security;
revoke all on private.viva_events from public, anon, authenticated;
grant all on private.viva_events to service_role;

alter table private.orders
  add column if not exists viva_order_code text unique,
  add column if not exists viva_transaction_id text;

alter table private.photo_originals
  add column if not exists storage_bucket text not null default 'photo-originals';
alter table private.photo_originals
  add constraint photo_originals_storage_bucket_valid
  check (storage_bucket in ('photo-originals', 'originals'));

alter table private.order_items
  add column if not exists original_bucket text not null default 'photo-originals';
alter table private.order_items
  add constraint order_items_original_bucket_valid
  check (original_bucket in ('photo-originals', 'originals'));

create or replace function private.set_order_item_original_bucket()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
begin
  select original.storage_bucket
    into new.original_bucket
    from private.photo_originals as original
    where original.photo_id = new.photo_id;
  if not found then
    raise exception 'Original photo storage metadata is unavailable'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists set_order_item_original_bucket on private.order_items;
create trigger set_order_item_original_bucket
  before insert on private.order_items
  for each row execute function private.set_order_item_original_bucket();

insert into storage.buckets (id, name, public)
values ('originals', 'originals', false), ('previews', 'previews', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "photo originals are never directly accessible" on storage.objects;
create policy "photo originals are never directly accessible"
  on storage.objects as restrictive for all to anon, authenticated
  using (bucket_id not in ('photo-originals', 'originals'))
  with check (bucket_id not in ('photo-originals', 'originals'));

drop policy if exists "public cannot insert photos bucket objects" on storage.objects;
create policy "public cannot insert gallery preview objects" on storage.objects
  as restrictive for insert to anon, authenticated
  with check (bucket_id not in ('photos', 'previews'));
drop policy if exists "public cannot update photos bucket objects" on storage.objects;
create policy "public cannot update gallery preview objects" on storage.objects
  as restrictive for update to anon, authenticated
  using (bucket_id not in ('photos', 'previews'))
  with check (bucket_id not in ('photos', 'previews'));
drop policy if exists "public cannot delete photos bucket objects" on storage.objects;
create policy "public cannot delete gallery preview objects" on storage.objects
  as restrictive for delete to anon, authenticated
  using (bucket_id not in ('photos', 'previews'));

create or replace function public.register_ingested_photo(
  photo_id_input uuid,
  preview_url_input text,
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
      or nullif(filename_input, '') is null
      or nullif(original_path_input, '') is null
      or original_bucket_input not in ('originals', 'photo-originals') then
    raise exception 'Invalid photo ingestion data' using errcode = '22023';
  end if;

  insert into public.photos (id, preview_url, filename, "timestamp")
  values (photo_id_input, preview_url_input, filename_input, timestamp_input);
  insert into private.photo_originals (photo_id, object_path, storage_bucket)
  values (photo_id_input, original_path_input, original_bucket_input);
  return photo_id_input;
end;
$$;

create or replace function public.get_photo_original_info(photo_id_input uuid)
returns jsonb
language sql
security definer
set search_path = pg_catalog, private
as $$
  select jsonb_build_object(
    'object_path', original.object_path,
    'storage_bucket', original.storage_bucket
  )
  from private.photo_originals as original
  where original.photo_id = photo_id_input;
$$;

create or replace function public.set_photo_order_viva_order(
  order_id_input uuid,
  viva_order_code_input text,
  access_token_hash_input text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
declare
  updated boolean;
begin
  if viva_order_code_input !~ '^[0-9]{6,24}$'
      or access_token_hash_input !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid Viva order data' using errcode = '22023';
  end if;
  update private.orders
  set viva_order_code = viva_order_code_input,
      access_token_hash = access_token_hash_input
  where id = order_id_input
    and status = 'pending'
    and viva_order_code is null
  returning true into updated;
  return coalesce(updated, false);
end;
$$;

create or replace function public.process_viva_payment(
  event_id_input text,
  order_code_input text,
  merchant_order_id_input uuid,
  transaction_id_input text,
  amount_total_cents_input bigint,
  currency_code_input integer,
  email_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
declare
  event_recorded integer;
  matched_order private.orders%rowtype;
begin
  if nullif(event_id_input, '') is null
      or nullif(transaction_id_input, '') is null
      or amount_total_cents_input is null
      or amount_total_cents_input <= 0
      or currency_code_input <> 978 then
    raise exception 'Invalid verified Viva payment data' using errcode = '22023';
  end if;

  select * into matched_order
  from private.orders
  where viva_order_code = order_code_input
    and id = merchant_order_id_input
  for update;
  if not found then
    raise exception 'Viva order was not found' using errcode = 'P0002';
  end if;

  insert into private.viva_events (id)
  values (event_id_input)
  on conflict (id) do nothing
  returning 1 into event_recorded;
  if event_recorded is null then
    return jsonb_build_object('duplicate', true);
  end if;
  if matched_order.status = 'paid' then
    return jsonb_build_object('processed', true, 'duplicatePayment', true);
  end if;
  if matched_order.status <> 'pending' then
    return jsonb_build_object('ignored', true, 'reason', 'order_not_pending');
  end if;
  if amount_total_cents_input <> matched_order.total_cents
      or matched_order.currency <> 'EUR' then
    raise exception 'Viva payment amount or currency does not match the order'
      using errcode = '22023';
  end if;

  update private.orders
  set status = 'paid',
      viva_transaction_id = transaction_id_input,
      email = nullif(email_input, ''),
      paid_at = now()
  where id = matched_order.id;

  return jsonb_build_object('processed', true, 'order_id', matched_order.id);
end;
$$;

create or replace function public.get_photo_order_for_download(
  session_id_input text default null,
  token_hash_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
declare
  matched_order private.orders%rowtype;
  order_items jsonb;
begin
  if (session_id_input is null) = (token_hash_input is null) then
    raise exception 'Provide either a checkout session or order token'
      using errcode = '22023';
  end if;

  select * into matched_order
  from private.orders
  where (session_id_input is not null and stripe_session_id = session_id_input)
     or (token_hash_input is not null and access_token_hash = token_hash_input);
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if matched_order.status <> 'paid' then
    return jsonb_build_object('status', matched_order.status);
  end if;

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'photo_id', item.photo_id,
      'filename', item.filename,
      'preview_url', item.preview_url,
      'original_path', item.original_path,
      'original_bucket', item.original_bucket
    ) order by item.filename),
    '[]'::jsonb
  )
  into order_items
  from private.order_items as item
  where item.order_id = matched_order.id;

  return jsonb_build_object(
    'status', matched_order.status,
    'order_id', matched_order.id,
    'currency', matched_order.currency,
    'subtotal_cents', matched_order.subtotal_cents,
    'tip_cents', matched_order.tip_cents,
    'total_cents', matched_order.total_cents,
    'items', order_items
  );
end;
$$;

drop function public.gallery_purge_candidates(integer);
create function public.gallery_purge_candidates(limit_input integer default 500)
returns table (
  photo_id uuid,
  preview_url text,
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
    case
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

revoke all on function public.register_ingested_photo(uuid, text, text, bigint, text, text)
  from public, anon, authenticated;
revoke all on function public.get_photo_original_info(uuid)
  from public, anon, authenticated;
revoke all on function public.set_photo_order_viva_order(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.process_viva_payment(text, text, uuid, text, bigint, integer, text)
  from public, anon, authenticated;
revoke all on function public.get_photo_order_for_download(text, text)
  from public, anon, authenticated;
revoke all on function public.gallery_purge_candidates(integer)
  from public, anon, authenticated;
grant execute on function public.register_ingested_photo(uuid, text, text, bigint, text, text)
  to service_role;
grant execute on function public.get_photo_original_info(uuid) to service_role;
grant execute on function public.set_photo_order_viva_order(uuid, text, text)
  to service_role;
grant execute on function public.process_viva_payment(text, text, uuid, text, bigint, integer, text)
  to service_role;
grant execute on function public.get_photo_order_for_download(text, text) to service_role;
grant execute on function public.gallery_purge_candidates(integer) to service_role;

notify pgrst, 'reload schema';
