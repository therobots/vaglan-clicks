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

The gallery displays watermarked, blurred previews in a three-column mobile grid. Visitors can filter by hour, select photos at €3.00 each, and preview them in a full-screen lightbox. Checkout is not available in the frontend-only setup selected for this project.

## Payments

Checkout and post-payment downloads are intentionally unavailable until a trusted payment backend is configured. The browser must not mark an order paid or unlock original photos; payment creation, Stripe webhook verification, and original-photo signed URL issuance must happen on a server. High-resolution originals belong in the private `photo-originals` bucket, with their object paths in `private.photo_originals`; never store original paths in the public `photos` table or expose a service-role key to the browser.
