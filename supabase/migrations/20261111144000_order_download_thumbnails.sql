alter table private.order_items
  add column if not exists thumbnail_url text;

create or replace function private.capture_order_item_thumbnail_url()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.thumbnail_url is null then
    select photo.thumbnail_url
      into new.thumbnail_url
      from public.photos as photo
      where photo.id = new.photo_id;
  end if;
  return new;
end;
$$;

revoke all on function private.capture_order_item_thumbnail_url()
  from public, anon, authenticated;

drop trigger if exists capture_order_item_thumbnail_url on private.order_items;
create trigger capture_order_item_thumbnail_url
  before insert on private.order_items
  for each row execute function private.capture_order_item_thumbnail_url();

update private.order_items as item
set thumbnail_url = photo.thumbnail_url
from public.photos as photo
where photo.id = item.photo_id
  and item.thumbnail_url is null;

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
      'thumbnail_url', item.thumbnail_url,
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
