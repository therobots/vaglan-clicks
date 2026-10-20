alter table public.photos
  add column if not exists hidden_at timestamptz;

create table if not exists private.removal_requests (
  id uuid primary key default gen_random_uuid(),
  photo_id uuid not null,
  reason text,
  contact text,
  ip_hash text not null,
  status text not null default 'pending'
    check (status in ('pending', 'restored', 'deleted')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists removal_requests_ip_created_idx
  on private.removal_requests (ip_hash, created_at desc);
create index if not exists removal_requests_status_created_idx
  on private.removal_requests (status, created_at desc);
create index if not exists removal_requests_photo_idx
  on private.removal_requests (photo_id, created_at desc);

alter table private.removal_requests enable row level security;
revoke all on private.removal_requests from public, anon, authenticated;
grant all on private.removal_requests to service_role;

create or replace function public.request_photo_removal(
  photo_id_input uuid,
  reason_input text,
  contact_input text,
  ip_hash_input text
)
returns table (
  request_id uuid,
  hidden_at timestamptz,
  recent_hide_count integer,
  rate_limited boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  ip_request_count integer;
  global_hide_count integer;
  current_is_hidden boolean;
  current_hidden_at timestamptz;
  current_request_id uuid;
begin
  if photo_id_input is null
      or ip_hash_input is null
      or length(ip_hash_input) <> 64
      or length(coalesce(reason_input, '')) > 1000
      or length(coalesce(contact_input, '')) > 320 then
    raise exception 'Invalid photo-removal request' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(ip_hash_input, 0));
  select count(*)::integer
    into ip_request_count
    from private.removal_requests as request
    where request.ip_hash = ip_hash_input
      and request.created_at > now() - interval '1 hour';

  if ip_request_count >= 10 then
    select count(*)::integer into global_hide_count
    from private.removal_requests as request
    where request.created_at > now() - interval '1 hour';
    return query select null::uuid, null::timestamptz, global_hide_count, true;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(photo_id_input::text, 1));
  select coalesce(photo.is_hidden, false), photo.hidden_at
    into current_is_hidden, current_hidden_at
    from public.photos as photo
    where photo.id = photo_id_input
      and photo.expires_at > now();
  if not found then
    raise exception 'Photo is no longer available' using errcode = 'P0002';
  end if;

  if current_is_hidden then
    if current_hidden_at is null then
      update public.photos as photo
      set hidden_at = now()
      where photo.id = photo_id_input
      returning photo.hidden_at into current_hidden_at;
    end if;
    select request.id
      into current_request_id
      from private.removal_requests as request
      where request.photo_id = photo_id_input
        and request.status = 'pending'
      order by request.created_at desc
      limit 1;
    if current_request_id is null then
      insert into private.removal_requests (photo_id, reason, contact, ip_hash)
      values (
        photo_id_input,
        nullif(trim(reason_input), ''),
        nullif(trim(contact_input), ''),
        ip_hash_input
      )
      returning id into current_request_id;
    end if;
    select count(*)::integer into global_hide_count
    from private.removal_requests as request
    where request.created_at > now() - interval '1 hour';
    return query select current_request_id, current_hidden_at, global_hide_count, false;
    return;
  end if;

  update public.photos as photo
  set is_hidden = true, hidden_at = now()
  where photo.id = photo_id_input;

  insert into private.removal_requests (photo_id, reason, contact, ip_hash)
  values (
    photo_id_input,
    nullif(trim(reason_input), ''),
    nullif(trim(contact_input), ''),
    ip_hash_input
  )
  returning id into current_request_id;

  select count(*)::integer into global_hide_count
  from private.removal_requests as request
  where request.created_at > now() - interval '1 hour';

  return query
    select current_request_id, now(), global_hide_count, false;
end;
$$;

create or replace function public.admin_list_photo_removal_requests()
returns table (
  request_id uuid,
  photo_id uuid,
  reason text,
  contact text,
  status text,
  created_at timestamptz,
  filename text,
  is_hidden boolean,
  paid_order_count bigint,
  recent_hide_count bigint,
  abuse_flagged boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  with recent as (
    select count(*) as total
    from private.removal_requests as request
    where request.created_at > now() - interval '1 hour'
  )
  select
    request.id,
    request.photo_id,
    request.reason,
    request.contact,
    request.status,
    request.created_at,
    photo.filename,
    coalesce(photo.is_hidden, false),
    (
      select count(*)
      from private.order_items as item
      join private.orders as order_record on order_record.id = item.order_id
      where item.photo_id = request.photo_id
        and order_record.paid_at is not null
    ) as paid_order_count,
    recent.total,
    recent.total > 20
  from private.removal_requests as request
  left join public.photos as photo on photo.id = request.photo_id
  cross join recent
  order by request.created_at desc
  limit 1000;
$$;

create or replace function public.admin_restore_photo_removal(request_id_input uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  photo_to_restore uuid;
begin
  select request.photo_id
    into photo_to_restore
    from private.removal_requests as request
    where request.id = request_id_input
      and request.status = 'pending'
    for update;
  if photo_to_restore is null then
    return false;
  end if;
  update public.photos
  set is_hidden = false, hidden_at = null
  where id = photo_to_restore
    and expires_at > now();
  if not found then
    return false;
  end if;
  update private.removal_requests
  set status = 'restored',
      resolved_at = now(),
      reason = null,
      contact = null,
      ip_hash = repeat('0', 64)
  where id = request_id_input;
  return true;
end;
$$;

create or replace function public.admin_mark_photo_removal_deleted(request_id_input uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
begin
  update private.removal_requests
  set status = 'deleted',
      resolved_at = now(),
      reason = null,
      contact = null,
      ip_hash = repeat('0', 64)
  where id = request_id_input and status = 'pending';
  return found;
end;
$$;

create or replace function public.admin_close_photo_removal_requests(photo_id_input uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
declare
  closed_count integer;
begin
  update private.removal_requests
  set status = 'deleted',
      resolved_at = now(),
      reason = null,
      contact = null,
      ip_hash = repeat('0', 64)
  where photo_id = photo_id_input and status = 'pending';
  get diagnostics closed_count = row_count;
  return closed_count;
end;
$$;

create or replace function public.admin_gallery_report()
returns table (
  night_key date,
  total_photos bigint,
  visible_photos bigint,
  hidden_photos bigint,
  expired_photos bigint,
  latest_capture bigint,
  latest_upload timestamptz,
  next_expiry timestamptz,
  paid_orders bigint,
  photo_revenue_cents bigint
)
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  with photo_report as (
    select
      public.gallery_night_key(photo."timestamp") as night_key,
      count(*) as total_photos,
      count(*) filter (
        where not coalesce(photo.is_hidden, false) and photo.expires_at > now()
      ) as visible_photos,
      count(*) filter (where coalesce(photo.is_hidden, false)) as hidden_photos,
      count(*) filter (where photo.expires_at <= now()) as expired_photos,
      max(photo."timestamp") as latest_capture,
      max(photo.created_at) as latest_upload,
      min(photo.expires_at) filter (where photo.expires_at > now()) as next_expiry
    from public.photos as photo
    where photo."timestamp" is not null
    group by public.gallery_night_key(photo."timestamp")
  ),
  sales_report as (
    select
      public.gallery_night_key(photo."timestamp") as night_key,
      count(distinct order_record.id) as paid_orders,
      coalesce(sum(item.unit_amount_cents), 0)::bigint as photo_revenue_cents
    from private.order_items as item
    join private.orders as order_record on order_record.id = item.order_id
    join public.photos as photo on photo.id = item.photo_id
    where order_record.paid_at is not null
      and photo."timestamp" is not null
    group by public.gallery_night_key(photo."timestamp")
  )
  select
    photo_report.night_key,
    photo_report.total_photos,
    photo_report.visible_photos,
    photo_report.hidden_photos,
    photo_report.expired_photos,
    photo_report.latest_capture,
    photo_report.latest_upload,
    photo_report.next_expiry,
    coalesce(sales_report.paid_orders, 0),
    coalesce(sales_report.photo_revenue_cents, 0)
  from photo_report
  left join sales_report using (night_key)
  order by photo_report.night_key desc;
$$;

create or replace function public.admin_sales_report()
returns table (
  order_id uuid,
  paid_at timestamptz,
  email text,
  photo_count bigint,
  subtotal_cents bigint,
  tip_cents integer,
  total_cents bigint,
  currency text,
  night_keys text
)
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select
    order_record.id,
    order_record.paid_at,
    order_record.email,
    count(item.photo_id),
    order_record.subtotal_cents,
    order_record.tip_cents,
    order_record.total_cents,
    order_record.currency,
    string_agg(
      distinct public.gallery_night_key(photo."timestamp")::text,
      ', ' order by public.gallery_night_key(photo."timestamp")::text
    )
  from private.orders as order_record
  join private.order_items as item on item.order_id = order_record.id
  left join public.photos as photo on photo.id = item.photo_id
  where order_record.paid_at is not null
  group by order_record.id
  order by order_record.paid_at desc, order_record.id desc;
$$;

revoke all on function public.request_photo_removal(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.admin_list_photo_removal_requests()
  from public, anon, authenticated;
revoke all on function public.admin_restore_photo_removal(uuid)
  from public, anon, authenticated;
revoke all on function public.admin_mark_photo_removal_deleted(uuid)
  from public, anon, authenticated;
revoke all on function public.admin_close_photo_removal_requests(uuid)
  from public, anon, authenticated;
revoke all on function public.admin_gallery_report()
  from public, anon, authenticated;
revoke all on function public.admin_sales_report()
  from public, anon, authenticated;
grant execute on function public.request_photo_removal(uuid, text, text, text)
  to service_role;
grant execute on function public.admin_list_photo_removal_requests()
  to service_role;
grant execute on function public.admin_restore_photo_removal(uuid)
  to service_role;
grant execute on function public.admin_mark_photo_removal_deleted(uuid)
  to service_role;
grant execute on function public.admin_close_photo_removal_requests(uuid)
  to service_role;
grant execute on function public.admin_gallery_report()
  to service_role;
grant execute on function public.admin_sales_report()
  to service_role;

notify pgrst, 'reload schema';
