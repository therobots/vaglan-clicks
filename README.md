# Vaglan Clicks

A live photo gallery built with React, Vite, and Supabase.

## Local setup

1. Install Node.js and npm.
2. Install dependencies with `npm install`.
3. Create `.env.local` in the project root:

   ```dotenv
   VITE_SUPABASE_URL=https://your-project-id.supabase.co
   VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
   VITE_INSTAGRAM_HANDLE=vaglan_clicks
   GALLERY_BASE_URL=https://your-project-id.supabase.co?album=general
   ```

   Use the project URL and **anon/public** key from the Supabase dashboard. Never put a service-role key in frontend configuration. The gallery URL can include a single `album` query parameter; the bridge validates it strictly and only accepts QR codes whose host/path matches the configured gallery base URL.

4. Back up the existing Supabase database, then follow [`docs/SETUP.md`](./docs/SETUP.md) to review/apply active migrations in timestamp order. Do not apply the archived `20261019210000_gallery_security.sql` in [`sql-archive/`](./sql-archive/); it assumes a different `photos` schema. The active migrations preserve existing photo rows, harden public access, add server-priced order/payment records, Athens-night navigation, per-night expiry, private photo-removal request handling, and watermarked preview storage.
5. Run `npm run dev` and open the local URL printed by Vite.

Without valid Supabase settings, the app displays a configuration message rather than making requests to placeholder credentials. Set `VITE_INSTAGRAM_HANDLE` to change the gallery footer profile; the default is `vaglan_clicks`. Run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` to check the app. `npm run test:e2e` runs the Playwright Info-page and order-token-route smoke tests; install Chromium with `npx playwright install chromium` first.

## Gallery and pricing

The camera bridge uploads untouched originals to the private `private-originals` bucket and physically watermarked WebP previews (1080px max dimension, quality 60) plus 300px WebP thumbnails (quality 60) to the public `public-previews` bucket. The gallery grid loads thumbnails; the full preview is loaded when a photo is opened. Gallery RPCs expose only rows marked `watermark_baked`; use the dry-run-first legacy rebuild procedure in [`docs/INGEST.md`](./docs/INGEST.md) to safely migrate older photos. Visitors can browse by Athens-local night and available capture-time slots, select photos for €2.00 for the first photo and €0.50 for each additional photo in Viva Wallet checkout, optionally add a €0/€1/€2/€3 tip, and preview them in a full-screen lightbox. Photos expire per night; the hourly purge remains in dry-run mode until an operator explicitly enables it as described in [`docs/SETUP.md`](./docs/SETUP.md).

See [`docs/INGEST.md`](./docs/INGEST.md) for camera-bridge configuration, album QR scans, and corrected UTC timestamps.

Album sessions use the public gallery query parameter `?album=042`; the value must match the pattern `^[A-Za-z0-9_-]{1,64}$` and preserve leading zeroes. The app reads the selected album from the URL, keeps cart selections per album, and filters every public gallery query to `photos.album_id` so a QR card cannot widen access to another album.

## Admin and free-photo setup

1. Apply the active migrations described in [`docs/SETUP.md`](./docs/SETUP.md). The admin migration adds `gallery_state`, `photos.is_free`, protected server-side admin sessions, and legacy timer storage; the following migrations restrict anon/authenticated writes, move the PIN hash into the private schema, add per-night expiry, private removal requests and reporting RPCs, Viva Wallet payment support, and physically watermarked preview storage. The historical Stripe checkout migration remains in timestamp order because later migrations extend its order schema; Viva Wallet is the active payment provider. The legacy timer is retained but no longer used. The previous `20261019210000_gallery_security.sql` in [`sql-archive/`](./sql-archive/) is archived and must not be applied.
2. Configure or rotate the private PIN hash in the Supabase SQL Editor. The entered PIN is checked only inside the Edge Function; the hash is never readable by public browser clients:

   ```sql
   insert into private.gallery_admin_credentials (id, pin_hash)
   values (1, crypt('REPLACE_WITH_A_LONG_PRIVATE_PIN', gen_salt('bf')))
   on conflict (id) do update
   set pin_hash = excluded.pin_hash;
   ```

3. Confirm that preview and thumbnail objects are stored in the public `public-previews` bucket and original objects are stored in the private `private-originals` bucket with their paths recorded in `private.photo_originals`.
4. Deploy `gallery-admin` and `request-photo-removal` to the configured Supabase project. Install or run the Supabase CLI, authenticate, link the project matching `VITE_SUPABASE_URL`, and deploy:

   ```powershell
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase functions deploy gallery-admin
   npx supabase functions deploy request-photo-removal --no-verify-jwt
   ```

   The project ref is the subdomain in the Supabase project URL (`https://YOUR_PROJECT_REF.supabase.co`). Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to deployed Edge Functions; do not add the service-role key to Vite environment variables. The admin dashboard and public removal requests require their functions to be deployed to the same project used by the frontend.
5. Open `/admin` to manage photos, review removal requests, export sales, browse Athens-night reports, and download the gallery QR code. Reset requires confirmation plus typing `RESET`. It deletes photo rows and public preview objects, but intentionally retains private original objects.

The public `/info` page is bilingual and includes the photo-removal request process. Have the operator-specific legal information reviewed and complete the checklist in [`docs/SETUP.md`](./docs/SETUP.md) before public sales.

The focused review adds private preview delivery and paid-order deletion protection. Follow the coordinated migration and deployment order in [`docs/SETUP.md`](./docs/SETUP.md); the Vercel preview route needs a server-only `SUPABASE_SERVICE_ROLE_KEY`. The operator's identity, public contact details, consumer terms, and canonical production URL are still needed before public-sales and discovery checks can pass.

Public free-photo downloads are issued as short-lived signed URLs only after the server verifies `photos.is_free`. Admin sessions expire after four hours and PIN attempts are rate-limited. Before deployment, follow the database backup, migration, and anon-access audit steps in [`docs/SETUP.md`](./docs/SETUP.md).

## Payments

Viva Wallet checkout is implemented with Supabase Edge Functions. Before enabling it, an authorized operator must back up the database and Storage, review and apply the active migrations in order, and configure the secrets and webhook described in [`docs/SETUP.md`](./docs/SETUP.md). Complete demo-mode purchases before accepting live payments.

The browser never sets the price or marks an order paid. Prices and allowed tips come from server-side gallery settings; Viva transaction verification marks the order paid, and `order-downloads` issues 15-minute signed URLs from the private originals bucket only after validating the private order token. The webhook does not issue download links. Original object paths remain private in `private.photo_originals` and paid-order records. Do not expose Viva or Supabase service-role secrets in Vite variables.
