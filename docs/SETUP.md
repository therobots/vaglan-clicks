# Deployment and security setup

## Before applying database migrations

Back up the existing Supabase database before applying migrations. The existing `photos` table is application-owned and must not be replaced or recreated. The old `20261019210000_gallery_security.sql` assumed a different schema and has been archived; do not apply it.

From the project directory, capture the existing public schema before applying changes:

```powershell
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
New-Item -ItemType Directory -Force C:\private-backups | Out-Null
npx supabase db dump --linked --schema public -f C:\private-backups\vaglan-public-schema-before-hardening.sql
npx supabase db dump --linked --data-only --schema public -f C:\private-backups\vaglan-public-data-before-hardening.sql
```

Keep the dumps in a private backup location and do not commit them. Also create a Supabase-managed database backup or point-in-time restore point before production changes, and separately back up the Storage objects and bucket configuration in `photos` and `photo-originals`; database dumps do not contain the stored image files. `C:\private-backups` is an example; replace it with a protected local folder.

## Apply the migrations

Review migration SQL against the captured schema, then apply migrations in timestamp order. `20261020000000_admin_timer_free_photos.sql` is additive for the existing gallery schema; `20261020091500_harden_public_gallery_access.sql` hardens public photo, timer, and storage access. They do not delete existing photo rows. The latter moves the existing admin PIN hash from `public.gallery_state` into `private.gallery_admin_credentials`.

For production, have an authorized operator apply the reviewed migration files through the Supabase Dashboard SQL Editor or the project's approved migration workflow. Verify `public.photos` still contains its existing rows after migration.

The hardening migration intentionally revokes direct anonymous/authenticated writes to Storage. Any camera uploader currently using the anon key to upload photos will stop working until the secure Phase 3 ingestion function is deployed. Schedule that cutover so it does not interrupt a live event.

The old migration is archived at `supabase\archive\20261019210000_gallery_security.sql` only for reference and must not be applied to this existing project.

## Admin PIN and Edge Function

Set or rotate the PIN by storing a bcrypt hash in the private credentials table. Do not put the PIN or hash in frontend environment variables:

```sql
insert into private.gallery_admin_credentials (id, pin_hash)
values (1, crypt('CHOOSE_A_LONG_PRIVATE_PIN', gen_salt('bf')))
on conflict (id) do update
set pin_hash = excluded.pin_hash;
```

Set the Supabase API schema cache to reload after SQL changes:

```sql
notify pgrst, 'reload schema';
```

Deploy `gallery-admin` to the same project as `VITE_SUPABASE_URL`. Edge Functions use Supabase's service-role secret internally; never expose that secret to the browser.

## Required anon-access audit

After applying migrations and deploying Edge Functions, run the anon-key security probe. It uses only the anon key. It does not invoke the mutating `reset_gallery_photos` or `start_gallery_timer` RPCs unless explicitly opted in:

```powershell
$env:VITE_SUPABASE_URL = "https://YOUR_PROJECT_REF.supabase.co"
$env:VITE_SUPABASE_ANON_KEY = "YOUR_PUBLIC_ANON_KEY"
node scripts\audit-anon-access.mjs
```

Alternatively, put only those two Vite values in `.env.local`; the script reads that file without printing the values. The audit expects public preview and timer reads to succeed, and photo mutations, admin RPCs, PIN access, original storage access, and preview-bucket writes to be denied. A free-photo download check is skipped if no free photo exists. Any `FAIL` requires investigation before production use. If an unexpected insert succeeds and cleanup fails, the audit reports the temporary row ID so an authorized operator can remove it.

The gallery reset and timer-start permission probes mutate production state if those RPCs are accidentally public. They are skipped by default for safety. Run them only against staging or after explicit approval, with a current backup, by setting `$env:AUDIT_ALLOW_MUTATING_RPCS = "1"` before running the script.

The audit includes a dummy private-object download. A storage provider response that indicates the dummy path is merely missing rather than access denied is reported as a failure; confirm private bucket restrictions in the Supabase Dashboard and rerun with a known private-object path if needed.

## Stripe launch steps (later phase)

Stripe must run in test mode first. Configure Stripe secrets only as Supabase Edge Function secrets, enable Apple Pay/Google Pay in Stripe Checkout settings, register the deployed webhook URL and required events, and verify test purchases before enabling live mode. Never use `VITE_*` variables for Stripe secret or webhook keys.
