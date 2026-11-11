create or replace function public.gallery_recently_hidden(album_id_input text default 'general')
returns table (photo_id uuid)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select photo.id
  from public.photos as photo
  where photo.album_id = coalesce(nullif(album_id_input, ''), 'general')
    and coalesce(photo.is_hidden, false)
    and photo.hidden_at >= now() - interval '2 minutes'
  order by photo.hidden_at desc, photo.id desc
  limit 1000;
$$;

revoke all on function public.gallery_recently_hidden(text)
  from public, anon, authenticated;
grant execute on function public.gallery_recently_hidden(text)
  to anon, authenticated;

notify pgrst, 'reload schema';
