create extension if not exists pgcrypto;

alter table public.gallery_state
  add column if not exists first_photo_cents integer not null default 200,
  add column if not exists extra_photo_cents integer not null default 50,
  add column if not exists tip_options_cents integer[] not null
    default array[0, 100, 200, 300],
  add column if not exists currency text not null default 'EUR';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.gallery_state'::regclass
      and conname = 'gallery_state_photo_prices_positive'
  ) then
    alter table public.gallery_state
      add constraint gallery_state_photo_prices_positive
      check (first_photo_cents > 0 and extra_photo_cents >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.gallery_state'::regclass
      and conname = 'gallery_state_tip_options_allowed'
  ) then
    alter table public.gallery_state
      add constraint gallery_state_tip_options_allowed
      check (tip_options_cents = array[0, 100, 200, 300]);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.gallery_state'::regclass
      and conname = 'gallery_state_currency_eur'
  ) then
    alter table public.gallery_state
      add constraint gallery_state_currency_eur check (currency = 'EUR');
  end if;
end
$$;

grant select (
  id, timer_ends_at, first_photo_cents, extra_photo_cents, tip_options_cents, currency
)
  on public.gallery_state to anon, authenticated;

create table if not exists private.orders (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'expired', 'refunded')),
  stripe_session_id text unique,
  stripe_payment_intent text,
  email text,
  subtotal_cents bigint not null check (subtotal_cents > 0),
  tip_cents integer not null default 0 check (tip_cents in (0, 100, 200, 300)),
  total_cents bigint not null check (total_cents > 0),
  currency text not null check (currency = 'EUR'),
  access_token_hash text unique,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists orders_payment_intent_idx
  on private.orders (stripe_payment_intent)
  where stripe_payment_intent is not null;

create table if not exists private.order_items (
  order_id uuid not null references private.orders(id) on delete restrict,
  photo_id uuid not null,
  unit_amount_cents integer not null check (unit_amount_cents > 0),
  original_path text not null,
  preview_url text,
  filename text not null,
  primary key (order_id, photo_id)
);
alter table private.order_items
  add column if not exists preview_url text;

create table if not exists private.stripe_events (
  id text primary key,
  processed_at timestamptz not null default now()
);

create table if not exists private.order_download_attempts (
  id bigint generated always as identity primary key,
  ip_address text not null,
  attempted_at timestamptz not null default now()
);
create index if not exists order_download_attempts_ip_time_idx
  on private.order_download_attempts (ip_address, attempted_at desc);
create index if not exists order_download_attempts_time_idx
  on private.order_download_attempts (attempted_at);

alter table private.orders enable row level security;
alter table private.order_items enable row level security;
alter table private.stripe_events enable row level security;
alter table private.order_download_attempts enable row level security;
revoke all on private.orders, private.order_items, private.stripe_events,
  private.order_download_attempts from public, anon, authenticated;
grant all on private.orders, private.order_items, private.stripe_events,
  private.order_download_attempts to service_role;

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
  photo_count integer;
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
      and not coalesce(photo.is_free, false);
  if available_photo_count <> photo_count then
    raise exception 'One or more selected photos are unavailable' using errcode = 'P0001';
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
  where not coalesce(photo.is_free, false);

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

create or replace function public.set_photo_order_stripe_session(
  order_id_input uuid,
  session_id_input text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
declare
  updated boolean;
begin
  update private.orders
  set stripe_session_id = session_id_input
  where id = order_id_input and status = 'pending'
  returning true into updated;
  return coalesce(updated, false);
end;
$$;

create or replace function public.expire_pending_photo_order(order_id_input uuid)
returns void
language sql
security definer
set search_path = pg_catalog, private
as $$
  update private.orders set status = 'expired'
  where id = order_id_input and status = 'pending';
$$;

create or replace function public.process_stripe_event(
  event_id_input text,
  event_type_input text,
  session_id_input text default null,
  payment_intent_input text default null,
  email_input text default null,
  amount_total_cents_input bigint default null,
  currency_input text default null,
  access_token_hash_input text default null
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
  insert into private.stripe_events (id)
  values (event_id_input)
  on conflict (id) do nothing
  returning 1 into event_recorded;
  if event_recorded is null then
    return jsonb_build_object('duplicate', true);
  end if;

  if event_type_input in ('checkout.session.completed', 'checkout.session.async_payment_succeeded') then
    select * into matched_order
    from private.orders
    where stripe_session_id = session_id_input
    for update;
    if not found then
      return jsonb_build_object('ignored', true, 'reason', 'order_not_found');
    end if;
    if matched_order.status = 'paid' then
      return jsonb_build_object('processed', true, 'notify', false);
    end if;
    if matched_order.status <> 'pending' then
      return jsonb_build_object('ignored', true, 'reason', 'order_not_pending');
    end if;
    if amount_total_cents_input is distinct from matched_order.total_cents
        or upper(currency_input) is distinct from matched_order.currency then
      raise exception 'Stripe payment amount or currency does not match the order'
        using errcode = '22023';
    end if;
    update private.orders
    set status = 'paid',
        stripe_payment_intent = payment_intent_input,
        email = email_input,
        access_token_hash = access_token_hash_input,
        paid_at = now()
    where id = matched_order.id;
    return jsonb_build_object(
      'processed', true,
      'notify', email_input is not null and access_token_hash_input is not null,
      'order_id', matched_order.id,
      'email', email_input
    );
  end if;

  if event_type_input = 'checkout.session.expired' then
    update private.orders
    set status = 'expired'
    where stripe_session_id = session_id_input and status = 'pending';
    return jsonb_build_object('processed', true);
  end if;

  if event_type_input in ('charge.refunded', 'charge.dispute.created') then
    update private.orders
    set status = 'refunded'
    where stripe_payment_intent = payment_intent_input
      and status = 'paid';
    return jsonb_build_object('processed', true);
  end if;

  return jsonb_build_object('ignored', true, 'reason', 'unsupported_event');
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
      'original_path', item.original_path
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
  delete from private.order_download_attempts
  where attempted_at < now() - make_interval(secs => window_seconds_input);
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

revoke all on function public.create_pending_photo_order(uuid[], integer)
  from public, anon, authenticated;
revoke all on function public.set_photo_order_stripe_session(uuid, text)
  from public, anon, authenticated;
revoke all on function public.expire_pending_photo_order(uuid)
  from public, anon, authenticated;
revoke all on function public.process_stripe_event(text, text, text, text, text, bigint, text, text)
  from public, anon, authenticated;
revoke all on function public.get_photo_order_for_download(text, text)
  from public, anon, authenticated;
revoke all on function public.consume_order_download_attempt(text, integer, integer)
  from public, anon, authenticated;

grant execute on function public.create_pending_photo_order(uuid[], integer) to service_role;
grant execute on function public.set_photo_order_stripe_session(uuid, text) to service_role;
grant execute on function public.expire_pending_photo_order(uuid) to service_role;
grant execute on function public.process_stripe_event(text, text, text, text, text, bigint, text, text)
  to service_role;
grant execute on function public.get_photo_order_for_download(text, text) to service_role;
grant execute on function public.consume_order_download_attempt(text, integer, integer)
  to service_role;

notify pgrst, 'reload schema';
