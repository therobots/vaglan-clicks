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

Keep the dumps in a private backup location and do not commit them. Also create a Supabase-managed database backup or point-in-time restore point before production changes, and separately back up the Storage objects and bucket configuration in `photos`, `photo-originals`, `previews`, `originals`, `public-previews`, and `private-originals`; database dumps do not contain the stored image files. `C:\private-backups` is an example; replace it with a protected local folder.

## Apply the migrations

Review migration SQL against the captured schema, then apply migrations in timestamp order. `20261020100000_stripe_checkout.sql` is a historical bootstrap migration retained because later payment migrations extend its server-priced order tables; Stripe checkout is deprecated and Viva Wallet is the active provider. Continue applying it in order for fresh databases. `20261020120000_photo_removal_requests.sql` adds removal requests and expanded admin reports; `20261020130000_viva_storage_ingest.sql` adds Viva payment verification and secure photo ingestion; `20261021170000_watermarked_photo_delivery.sql` adds thumbnail metadata, the new public/private Storage buckets, and the updated gallery RPC contract. The migrations do not replace the `photos` table. The hardening migration moves the existing admin PIN hash from `public.gallery_state` into `private.gallery_admin_credentials`.

For production, have an authorized operator apply all reviewed active migration files in timestamp order through the Supabase Dashboard SQL Editor or the project's approved migration workflow. The checkout migration adds server-priced EUR orders and payment records; the gallery migration safely backfills missing expiry values to at least 48 hours from migration time. Verify `public.photos` still contains its existing rows and that existing rows have future `expires_at` values after migration.

The new buckets are used by future camera-bridge uploads. Existing image objects and URLs in legacy buckets are not moved by this migration and remain supported; migrate those objects separately if you want to consolidate them.

The hardening migration intentionally revokes direct anonymous/authenticated writes to Storage. The local camera bridge needs the service-role key in its trusted process environment; never put it in frontend configuration. Follow [`INGEST.md`](./INGEST.md) for bridge setup, required UTC timestamps, Athens night grouping, and storage paths.

The old migration is archived at `sql-archive\20261019210000_gallery_security.sql` only for reference and must not be applied to this existing project.

## Per-night expiry and scheduled purge

The active gallery migrations add `photos.expires_at`, computed by a database trigger as 12:00 Europe/Athens on the day after the capture night plus `gallery_state.retention_hours` (default 48), and private removal-request tracking. Existing rows are backfilled safely. The old `gallery_state.timer_ends_at` column and timer RPCs remain for migration compatibility, but the public application and admin UI no longer use them.

The `20261020120000_photo_removal_requests.sql` migration adds immediate public soft-hiding, private removal requests, a ten-request-per-hour IP limit, an elevated-volume flag for more than twenty requests per hour, and service-role-only admin RPCs. Apply it after the night-retention migration, then deploy the request and admin functions:

```powershell
npx supabase functions deploy request-photo-removal --no-verify-jwt
npx supabase functions deploy gallery-admin
```

Removal details and contact information are visible only in the PIN-protected admin dashboard and are erased when a request is restored or permanently resolved. The public app listens for photo-hide broadcasts and also reconciles visible photos every 30 seconds in case a client misses a broadcast. This migration and deployment are operator-controlled; do not apply them to production before the schema backup and review steps above.

Purge is deliberately **dry-run only by default**. `gallery_state.purge_enabled` defaults to `false`; `purge-gallery` logs eligible photo, preview, and original counts without deleting. The function processes up to 500 expired photos per run. Paid originals are retained until the most recent associated `paid_at + paid_retention_days` (default 30 days); eligible previews and originals are removed before a photo row. Back up production and verify the behavior against staging data before enabling deletion.

To schedule the dry-run:

1. Set a separate random purge secret and deploy the function with JWT verification disabled. The function authenticates scheduled calls using the secret header:

   ```powershell
   npx supabase secrets set PURGE_JOB_SECRET="REPLACE_WITH_A_RANDOM_SECRET_OF_AT_LEAST_32_CHARACTERS"
   npx supabase functions deploy purge-gallery --no-verify-jwt
   ```

2. Enable the `pg_cron`, `pg_net`, and Vault extensions in the Supabase Dashboard. Store the same generated secret in Vault; never commit the secret or paste it into chat:

   ```sql
   select vault.create_secret(
     'REPLACE_WITH_THE_SAME_SECRET',
     'vaglan_purge_secret',
     'Authorization for the scheduled purge Edge Function'
   );
   ```

3. In the SQL Editor, schedule an hourly dry-run. Replace `YOUR_PROJECT_REF`; use the project that matches `VITE_SUPABASE_URL`.

   ```sql
   select cron.schedule(
     'vaglan-gallery-purge-hourly',
     '15 * * * *',
     $job$
       select net.http_post(
         url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/purge-gallery',
         headers := jsonb_build_object(
           'Content-Type', 'application/json',
           'x-purge-secret', (
             select decrypted_secret
             from vault.decrypted_secrets
             where name = 'vaglan_purge_secret'
           )
         ),
         body := '{}'::jsonb
       );
     $job$
   );
   ```

4. Review the function logs across multiple dry-run cycles. Confirm candidate counts and paid-original retention match expectations. The function remains non-destructive until `purge_enabled` is changed.
5. Only after review, backup, staging verification, and explicit operator approval, enable deletion:

   ```sql
   update public.gallery_state set purge_enabled = true where id = 1;
   ```

   Disable it to return to log-only mode:

   ```sql
   update public.gallery_state set purge_enabled = false where id = 1;
   ```

The schedule and function can be deployed while purge remains disabled. Do not enable deletion until storage paths and paid-retention behavior have been tested against staging data.

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

## Publication and legal-review checklist

The `/info` page contains an English/Greek overview, but its legal language is not a substitute for jurisdiction-specific legal advice. Before public sales, have a qualified lawyer review the service for Greece/EU and complete every operator-specific detail:

- [ ] Add the photographer's legal name or business name, registered/contact address, and monitored privacy/support email.
- [ ] Publish the data controller identity, contact method, purposes and legal bases for gallery, checkout, receipt delivery, fraud prevention, and removal-request processing.
- [ ] Document categories of data, recipients/processors (including Supabase and Viva Payments), international transfers, retention periods, and how people exercise their rights or contact the relevant supervisory authority.
- [ ] Confirm consent/notice requirements for photography at each venue, the lawful basis for publishing identifiable people, and a procedure for minors and sensitive situations.
- [ ] Confirm cookie/local-storage disclosures and retention for the selected-photo cart and dismissed notice.
- [ ] Publish pricing, taxes/VAT treatment, payment and delivery terms, cancellation/refund policy, and the correct consumer withdrawal-rights information for digital content.
- [ ] Confirm copyright/licensing terms for purchased downloads, permitted use, and the process for intellectual-property or privacy complaints.
- [ ] Test the removal-request process end to end, including immediate hiding, the ten-per-hour/IP limit, high-volume flagging, admin restoration, permanent deletion, and impact on previous paid downloads.
- [ ] Replace or verify all explanatory placeholders on `/info` and in Viva checkout before launch.

Do not treat a completed checklist as legal approval; obtain the required professional review and retain the reviewed policy versions.

## Required anon-access audit

After applying migrations and deploying Edge Functions, run the anon-key security probe. It uses only the anon key. It checks public preview/pricing/time-navigation reads and denied writes. It does not invoke the mutating `reset_gallery_photos` RPC unless explicitly opted in:

```powershell
$env:VITE_SUPABASE_URL = "https://YOUR_PROJECT_REF.supabase.co"
$env:VITE_SUPABASE_ANON_KEY = "YOUR_PUBLIC_ANON_KEY"
node scripts\audit-anon-access.mjs
```

Alternatively, put only those two Vite values in `.env.local`; the script reads that file without printing the values. The audit expects public preview, pricing, server-clock, and time-navigation reads to succeed, and photo mutations, admin RPCs, PIN access, original storage access, and preview-bucket writes to be denied. A free-photo download check is skipped if no free photo exists. Any `FAIL` requires investigation before production use. If an unexpected insert succeeds and cleanup fails, the audit reports the temporary row ID so an authorized operator can remove it.

The gallery reset permission probe could mutate production state if its RPC is accidentally public. It is skipped by default for safety. Run it only against staging or after explicit approval, with a current backup, by setting `$env:AUDIT_ALLOW_MUTATING_RPCS = "1"` before running the script.

The audit includes a dummy private-object download. A storage provider response that indicates the dummy path is merely missing rather than access denied is reported as a failure; confirm private bucket restrictions in the Supabase Dashboard and rerun with a known private-object path if needed.

The removal checks verify that anonymous clients cannot call the private removal RPC, malformed IDs are rejected, and a supplied hidden/expired fixture is rejected without changing it. Set `AUDIT_UNAVAILABLE_PHOTO_ID` to a known hidden/expired UUID to run that fixture check. The IP-limit check is skipped by default. To exercise it, use a clean staging project and a fresh requester IP, create exactly 11 disposable visible fixture photos, and pass their UUIDs:

```powershell
$env:AUDIT_ALLOW_MUTATING_REMOVALS = "1"
$env:AUDIT_REMOVAL_TEST_PHOTO_IDS = '["UUID-1","UUID-2","UUID-3","UUID-4","UUID-5","UUID-6","UUID-7","UUID-8","UUID-9","UUID-10","UUID-11"]'
node scripts\audit-anon-access.mjs
```

This intentionally hides the first ten fixtures and verifies that request eleven is rate-limited. Never run it against production or real gallery photos.

The Info page smoke test runs with Playwright and Vite; install Chromium once with `npx playwright install chromium`, then run `npm run test:e2e`. It checks the Info route, language switching and document `lang`, and navigation back to the gallery.

## Viva Wallet checkout and secure downloads

Back up production data and apply the migrations in timestamp order before deploying payment functions. `create-viva-order` asks the database to validate the selected photos and calculate the EUR total from server-side prices; the browser-provided amount is never trusted. Confirm that original objects are in private Storage and have paths recorded in `private.photo_originals`; a photo without an original cannot be purchased.

Configure these Supabase Edge Function secrets in the Dashboard or approved secret manager; never put them in `.env.local` or Vite `VITE_*` variables:

- `VIVA_ENVIRONMENT`: `demo` for testing or `live` for real payments.
- `VIVA_CLIENT_ID` and `VIVA_CLIENT_SECRET`: Viva API credentials.
- `VIVA_SOURCE_CODE`: the merchant source code enabled for redirect checkout.
- `VIVA_WEBHOOK_KEY`: a high-entropy secret configured as the webhook authorization key.
- `SITE_URL`: public HTTPS origin of the gallery (for example, `https://gallery.example.com`).

Deploy the functions to the same project as `VITE_SUPABASE_URL`:

```powershell
npx supabase functions deploy create-viva-order
npx supabase functions deploy order-downloads
npx supabase functions deploy viva-webhook --no-verify-jwt
```

Configure Viva to send payment notifications to `https://YOUR_PROJECT_REF.supabase.co/functions/v1/viva-webhook` with the `Key YOUR_VIVA_WEBHOOK_KEY` authorization header. The webhook independently looks up each transaction with Viva and checks its order reference, completed status, amount, and EUR currency before marking an order paid. `create-viva-order` and `order-downloads` require the Supabase JWT; the webhook authenticates using the configured secret.

Gallery pricing is configured in `public.gallery_state.first_photo_cents` (default `200`), `extra_photo_cents` (default `50`), and `tip_options_cents` (fixed to `[0,100,200,300]`). The `private.orders` row stores `subtotal_cents`, `tip_cents`, and `total_cents`; the webhook compares Viva's verified transaction amount against the recorded total. The webhook does not return private download URLs. Once payment is confirmed, `order-downloads` validates the private order token and creates 15-minute signed URLs from the recorded private original bucket.

Run `npm test` for the shared pricing tests. In Viva demo mode, verify one, two, three, and ten photos total EUR 2.00, 2.50, 3.00, and 6.50. For three photos plus a EUR 2 tip, verify EUR 5.00; test EUR 3 tips across a reload, invalid tip values, and reject an empty photo selection. Confirm unpaid/expired orders do not unlock downloads, signed original URLs expire after 15 minutes, and duplicate webhook notifications do not double-process payment. Only after these checks should an authorized operator switch Viva to live mode. Do not paste secrets into chat, source control, or build-time frontend environment variables.
