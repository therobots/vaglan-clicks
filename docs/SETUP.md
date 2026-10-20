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

Review migration SQL against the captured schema, then apply migrations in timestamp order. `20261020000000_admin_timer_free_photos.sql` is additive for the existing gallery schema; `20261020091500_harden_public_gallery_access.sql` hardens public photo, legacy timer, and storage access; `20261020100000_stripe_checkout.sql` adds server-priced payment records; and `20261020110000_night_retention_and_gallery_queries.sql` adds Athens-night navigation, hidden/expiry fields, and read-only gallery RPCs. The migrations do not replace the `photos` table. The hardening migration moves the existing admin PIN hash from `public.gallery_state` into `private.gallery_admin_credentials`.

For production, have an authorized operator apply all reviewed active migration files in timestamp order through the Supabase Dashboard SQL Editor or the project's approved migration workflow. The checkout migration adds server-priced EUR orders and payment records; the gallery migration safely backfills missing expiry values to at least 48 hours from migration time. Verify `public.photos` still contains its existing rows and that existing rows have future `expires_at` values after migration.

The hardening migration intentionally revokes direct anonymous/authenticated writes to Storage. Any camera uploader currently using the anon key to upload photos will stop working until a secure ingestion function is deployed. Schedule that cutover to avoid interrupting photo uploads. Follow [`INGEST.md`](./INGEST.md) for required UTC timestamps, Athens night grouping, and storage paths; this repository does not currently contain a camera-ingestion agent.

The old migration is archived at `supabase\archive\20261019210000_gallery_security.sql` only for reference and must not be applied to this existing project.

## Per-night expiry and scheduled purge

The active gallery migration adds `photos.expires_at`, computed by a database trigger as 12:00 Europe/Athens on the day after the capture night plus `gallery_state.retention_hours` (default 48). Existing rows are backfilled safely. The old `gallery_state.timer_ends_at` column and timer RPCs remain for migration compatibility, but the public application and admin UI no longer use them.

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

## Stripe checkout and secure downloads

Back up production data and apply the active migrations in timestamp order before deploying payment functions. The checkout migration adds server-priced EUR orders and payment-event/download-rate-limit records without replacing the existing photo table or deleting gallery rows. Confirm that the private `photo-originals` bucket and `private.photo_originals` map are populated before enabling checkout; a photo without an original cannot be purchased.

Configure these Supabase Edge Function secrets in the Dashboard or approved secret manager; never put them in `.env.local` or Vite `VITE_*` variables:

- `STRIPE_SECRET_KEY`: Stripe test secret key for initial verification.
- `STRIPE_WEBHOOK_SECRET`: signing secret for the deployed webhook endpoint.
- `SITE_URL`: public HTTPS origin of the gallery (for example, `https://gallery.example.com`).
- `RESEND_API_KEY` and `EMAIL_FROM`: receipt delivery configuration. Email failures are logged and do not change the already-verified payment status; the success page can also retrieve the order with Stripe's checkout session reference.

Deploy the functions to the same project as `VITE_SUPABASE_URL`:

```powershell
npx supabase functions deploy create-checkout-session
npx supabase functions deploy order-downloads
npx supabase functions deploy stripe-webhook
```

In Stripe test mode, register `https://YOUR_PROJECT_REF.supabase.co/functions/v1/stripe-webhook` and subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`, `charge.refunded`, and `charge.dispute.created`. The webhook function intentionally has JWT verification disabled because Stripe authenticates requests with its signature; the other two functions require the Supabase JWT sent by the frontend. Configure Apple Pay and Google Pay in Stripe Checkout settings if those wallet methods are desired.

Gallery pricing is configured in `public.gallery_state.first_photo_cents` (default `200`), `extra_photo_cents` (default `50`), and `tip_options_cents` (fixed to `[0,100,200,300]`). The server calculates the total and Stripe receives separate line items for the first photo, additional photos, and an optional tip. The `private.orders` row stores `subtotal_cents`, `tip_cents`, and `total_cents`; the webhook compares Stripe's final `amount_total` against `total_cents` before marking a purchase paid.

Run `npm test` for the client and Edge Function shared pricing tests. In Stripe test mode, verify one, two, three, and ten photos total EUR 2.00, 2.50, 3.00, and 6.50. For three photos plus a EUR 2 tip, verify EUR 5.00; test EUR 3 tips across a reload, invalid tip values, and reject an empty photo selection. Then confirm unpaid/expired sessions do not unlock downloads, and signed original URLs expire after 15 minutes. Exercise full and partial refunds, webhook retries, and payment confirmation delays. Only after these checks should an authorized operator switch the Stripe secret/webhook to live mode. Do not paste secrets into chat, source control, or build-time frontend environment variables.
