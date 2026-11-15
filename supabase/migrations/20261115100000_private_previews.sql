-- Gallery previews must pass the visibility check in /api/preview.
-- Deploy the API/frontend and configure SUPABASE_SERVICE_ROLE_KEY before applying.
update storage.buckets
set public = false
where id in ('public-previews', 'previews', 'photos');
