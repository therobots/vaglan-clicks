do $$
declare
  photo_columns text;
begin
  if to_regclass('public.photos') is null then
    raise exception 'Expected existing public.photos table; refusing to revoke privileges from a missing table.';
  end if;

  revoke select on table public.photos from public, anon, authenticated;

  select string_agg(format('%I', column_name), ', ' order by ordinal_position)
  into photo_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'photos';

  if photo_columns is not null then
    execute format(
      'revoke select (%s) on table public.photos from public, anon, authenticated',
      photo_columns
    );
  end if;

  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'photos'
  ) then
    alter publication supabase_realtime drop table public.photos;
  end if;
end;
$$;

notify pgrst, 'reload schema';
