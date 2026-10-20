# Vaglan Clicks

A live event-photo gallery built with React, Vite, and Supabase.

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

4. Back up the existing Supabase database, then follow [`docs/SETUP.md`](./docs/SETUP.md) to review/apply active migrations in timestamp order. Do not apply the archived `20261019210000_gallery_security.sql`; it assumes a different `photos` schema. The active migrations preserve existing photo rows, harden public access, and add server-priced order/payment records.
5. Run `npm run dev` and open the local URL printed by Vite.

Without valid Supabase settings, the app displays a configuration message rather than making requests to placeholder credentials. Set `VITE_INSTAGRAM_HANDLE` to change the gallery footer profile; the default is `vaglan_clicks`. Run `npm run lint` and `npm run build` to check the frontend.

## Gallery and pricing

The gallery displays watermarked, blurred previews in a three-column mobile grid. Visitors can filter by hour, select photos for €2.00 for the first photo and €0.50 for each additional photo in the checkout, optionally add a €0/€1/€2/€3 tip, and preview them in a full-screen lightbox.

## Admin and free-photo setup

1. Apply the active migrations described in [`docs/SETUP.md`](./docs/SETUP.md). The admin/timer migration adds `gallery_state`, `photos.is_free`, protected server-side admin sessions, and timer RPCs; the next migration restricts anon/authenticated writes and moves the PIN hash into the private schema. The previous `20261019210000_gallery_security.sql` is archived and must not be applied.
2. Configure or rotate the private PIN hash in the Supabase SQL Editor. The entered PIN is checked only inside the Edge Function; the hash is never readable by public browser clients:

   ```sql
   insert into private.gallery_admin_credentials (id, pin_hash)
   values (1, crypt('REPLACE_WITH_A_LONG_PRIVATE_PIN', gen_salt('bf')))
   on conflict (id) do update
   set pin_hash = excluded.pin_hash;
   ```

3. Confirm that preview objects are stored in the public `photos` bucket and original objects are stored in the private `photo-originals` bucket with their paths recorded in `private.photo_originals`.
4. The current `gallery-admin` function is deployed to the configured Supabase project. For future updates, install or run the Supabase CLI, authenticate, link the project matching `VITE_SUPABASE_URL`, and deploy:

   ```powershell
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase functions deploy gallery-admin
   ```

   The project ref is the subdomain in the Supabase project URL (`https://YOUR_PROJECT_REF.supabase.co`). Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to deployed Edge Functions; do not add the service-role key to Vite environment variables. The `/admin` login cannot work until this function is deployed to the same project used by the frontend.
5. Open `/admin` to manage photos and start the 48-hour timer. Reset requires confirmation plus typing `RESET`. It deletes all photo rows and empties the `photos` preview bucket; it deliberately retains original objects in `photo-originals`.

Public free-photo downloads are issued as short-lived signed URLs only after the server verifies `photos.is_free`. Admin sessions expire after four hours and PIN attempts are rate-limited. Before deployment, follow the database backup, migration, and anon-access audit steps in [`docs/SETUP.md`](./docs/SETUP.md).

## Payments

The Stripe flow is implemented with Supabase Edge Functions. Before enabling it, an authorized operator must back up the database and Storage, review and apply the active migrations in order, and configure the secrets and Stripe webhook described in [`docs/SETUP.md`](./docs/SETUP.md). Run Stripe test-mode purchases before accepting live payments.

The browser never sets the price or marks an order paid. Prices and allowed tips come from server-side gallery settings; Stripe webhook signature verification marks the order paid, and `order-downloads` issues 15-minute signed URLs from the private `photo-originals` bucket. Original object paths remain private in `private.photo_originals` and paid-order records. Stripe Checkout collects the customer email. A receipt email provider is configured server-side; do not expose Stripe, Resend, or Supabase service-role secrets in Vite variables.
