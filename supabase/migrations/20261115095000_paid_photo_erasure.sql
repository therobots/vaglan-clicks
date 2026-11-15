alter table private.order_items
  add column if not exists erased_at timestamptz;

create or replace function public.admin_paid_photo_order_count(photo_id_input uuid)
returns integer
language sql
stable
security definer
set search_path = pg_catalog, private
as $$
  select count(distinct item.order_id)::integer
  from private.order_items as item
  join private.orders as purchase on purchase.id = item.order_id
  where item.photo_id = photo_id_input and purchase.status = 'paid';
$$;

create or replace function public.admin_mark_photo_erased(photo_id_input uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
declare affected integer;
begin
  update private.order_items as item
  set erased_at = now()
  from private.orders as purchase
  where item.order_id = purchase.id
    and item.photo_id = photo_id_input
    and purchase.status = 'paid'
    and item.erased_at is null;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.admin_paid_photo_order_count(uuid) from public, anon, authenticated;
revoke all on function public.admin_mark_photo_erased(uuid) from public, anon, authenticated;
grant execute on function public.admin_paid_photo_order_count(uuid) to service_role;
grant execute on function public.admin_mark_photo_erased(uuid) to service_role;

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
    raise exception 'Provide either a checkout session or order token' using errcode = '22023';
  end if;
  select * into matched_order from private.orders
  where (session_id_input is not null and stripe_session_id = session_id_input)
     or (token_hash_input is not null and access_token_hash = token_hash_input);
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if matched_order.status <> 'paid' then
    return jsonb_build_object('status', matched_order.status);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'photo_id', item.photo_id,
    'filename', item.filename,
    'preview_url', item.preview_url,
    'thumbnail_url', item.thumbnail_url,
    'original_path', item.original_path,
    'original_bucket', item.original_bucket,
    'erased_at', item.erased_at
  ) order by item.filename), '[]'::jsonb)
  into order_items from private.order_items as item
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

notify pgrst, 'reload schema';
