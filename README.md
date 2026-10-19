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

4. Review and apply the schema/security migration in `supabase/migrations/`. It defines events, public preview metadata, sync status, pending-only order storage, and a private originals bucket. It is a starting schema for this app; inspect and back up any existing Supabase tables before applying it, since an existing `photos` table may need a data-preserving migration.
5. Run `npm run dev` and open the local URL printed by Vite.

Without valid Supabase settings, the app displays a configuration message rather than making requests to placeholder credentials. Set `VITE_INSTAGRAM_HANDLE` to change the gallery footer profile; the default is `vaglan_clicks`. Run `npm run lint` and `npm run build` to check the frontend.

## Gallery and pricing

The gallery displays watermarked, blurred previews in a three-column mobile grid. Visitors can filter by hour, select photos for €2.00 for the first photo and €0.50 for each additional photo in the selection, and preview them in a full-screen lightbox. Checkout is not available in the frontend-only setup selected for this project.

## Admin and free-photo setup

1. For the existing `vaglan-clicks` Supabase project, run the updated `20261020000000_admin_timer_free_photos.sql` migration in the Supabase Dashboard SQL Editor. The older `20261019210000_gallery_security.sql` assumes a different `photos` schema and must not be run against this existing database unchanged. The admin migration adds the missing RPCs and session tables, and is compatible with the existing `photos` columns.
2. Configure the singleton PIN hash in the Supabase SQL Editor. The entered PIN is checked only inside the Edge Function; it is never readable by public browser clients:

   ```sql
   update public.gallery_state
   set admin_pin = crypt('REPLACE_WITH_A_LONG_PRIVATE_PIN', gen_salt('bf'))
   where id = 1;
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

Public free-photo downloads are issued as short-lived signed URLs only after the server verifies `photos.is_free`. Admin sessions expire after four hours and PIN attempts are rate-limited. The SQL migration has not been applied to the production project; review and back up existing data before applying it.

## Payments

Checkout and post-payment downloads are intentionally unavailable until a trusted payment backend is configured. The browser must not mark an order paid or unlock original photos; payment creation, Stripe webhook verification, and original-photo signed URL issuance must happen on a server. High-resolution originals belong in the private `photo-originals` bucket, with their object paths in `private.photo_originals`; never store original paths in the public `photos` table or expose a service-role key to the browser.
