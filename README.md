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
   ```

   Use the project URL and **anon/public** key from the Supabase dashboard. Never put a service-role key in frontend configuration.

4. Back up the existing Supabase database, then follow [`docs/SETUP.md`](./docs/SETUP.md) to review/apply active migrations in timestamp order. Do not apply the archived `20261019210000_gallery_security.sql`; it assumes a different `photos` schema. The active migrations preserve existing photo rows, harden public access, add server-priced order/payment records, Athens-night navigation, per-night expiry, and private photo-removal request handling.
5. Run `npm run dev` and open the local URL printed by Vite.

Without valid Supabase settings, the app displays a configuration message rather than making requests to placeholder credentials. Set `VITE_INSTAGRAM_HANDLE` to change the gallery footer profile; the default is `vaglan_clicks`. Run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` to check the app. `npm run test:e2e` runs the Playwright Info-page and order-token-route smoke tests; install Chromium with `npx playwright install chromium` first.

## Gallery and pricing

The gallery displays watermarked, blurred previews in a three-column mobile grid. Visitors can browse by Athens-local night and available capture-time slots, select photos for €2.00 for the first photo and €0.50 for each additional photo in the checkout, optionally add a €0/€1/€2/€3 tip, and preview them in a full-screen lightbox. Photos expire per night; the hourly purge remains in dry-run mode until an operator explicitly enables it as described in [`docs/SETUP.md`](./docs/SETUP.md).

Camera ingestion must use corrected UTC capture timestamps and night-prefixed storage paths. See [`docs/INGEST.md`](./docs/INGEST.md); this repository does not currently include the camera-ingestion agent.

## Admin and free-photo setup

1. Apply the active migrations described in [`docs/SETUP.md`](./docs/SETUP.md). The admin migration adds `gallery_state`, `photos.is_free`, protected server-side admin sessions, and legacy timer storage; the following migrations restrict anon/authenticated writes, move the PIN hash into the private schema, add per-night expiry, and add private removal requests and reporting RPCs. The legacy timer is retained but no longer used. The previous `20261019210000_gallery_security.sql` is archived and must not be applied.
2. Configure or rotate the private PIN hash in the Supabase SQL Editor. The entered PIN is checked only inside the Edge Function; the hash is never readable by public browser clients:

   ```sql
   insert into private.gallery_admin_credentials (id, pin_hash)
   values (1, crypt('REPLACE_WITH_A_LONG_PRIVATE_PIN', gen_salt('bf')))
   on conflict (id) do update
   set pin_hash = excluded.pin_hash;
   ```

3. Confirm that preview objects are stored in the public `photos` bucket and original objects are stored in the private `photo-originals` bucket with their paths recorded in `private.photo_originals`.
4. Deploy `gallery-admin` and `request-photo-removal` to the configured Supabase project. Install or run the Supabase CLI, authenticate, link the project matching `VITE_SUPABASE_URL`, and deploy:

   ```powershell
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase functions deploy gallery-admin
   npx supabase functions deploy request-photo-removal --no-verify-jwt
   ```

   The project ref is the subdomain in the Supabase project URL (`https://YOUR_PROJECT_REF.supabase.co`). Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to deployed Edge Functions; do not add the service-role key to Vite environment variables. The admin dashboard and public removal requests require their functions to be deployed to the same project used by the frontend.
5. Open `/admin` to manage photos, review removal requests, export sales, browse Athens-night reports, and download the gallery QR code. Reset requires confirmation plus typing `RESET`. It deletes all photo rows and empties the `photos` preview bucket; it deliberately retains original objects in `photo-originals`.

The public `/info` page is bilingual and includes the photo-removal request process. Have the operator-specific legal information reviewed and complete the checklist in [`docs/SETUP.md`](./docs/SETUP.md) before public sales.

Public free-photo downloads are issued as short-lived signed URLs only after the server verifies `photos.is_free`. Admin sessions expire after four hours and PIN attempts are rate-limited. Before deployment, follow the database backup, migration, and anon-access audit steps in [`docs/SETUP.md`](./docs/SETUP.md).

## Payments

The Stripe flow is implemented with Supabase Edge Functions. Before enabling it, an authorized operator must back up the database and Storage, review and apply the active migrations in order, and configure the secrets and Stripe webhook described in [`docs/SETUP.md`](./docs/SETUP.md). Run Stripe test-mode purchases before accepting live payments.

The browser never sets the price or marks an order paid. Prices and allowed tips come from server-side gallery settings; Stripe webhook signature verification marks the order paid, and `order-downloads` issues 15-minute signed URLs from the private `photo-originals` bucket. Original object paths remain private in `private.photo_originals` and paid-order records. Stripe Checkout collects the customer email. A receipt email provider is configured server-side; do not expose Stripe, Resend, or Supabase service-role secrets in Vite variables.
