create or replace function public.gallery_recently_restored(album_id_input text default 'general')
returns table (photo_id uuid)
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select distinct request.photo_id
  from private.removal_requests as request
  join public.photos as photo on photo.id = request.photo_id
  where request.status = 'restored'
    and request.resolved_at >= now() - interval '2 minutes'
    and photo.album_id = coalesce(nullif(album_id_input, ''), 'general')
  order by request.photo_id
  limit 1000;
$$;

revoke all on function public.gallery_recently_restored(text)
  from public, anon, authenticated;
grant execute on function public.gallery_recently_restored(text)
  to anon, authenticated;

notify pgrst, 'reload schema';
