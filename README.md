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

4. Create a `public.photos` table with an `id`, `preview_url`, and `timestamp` column. `filename` is optional. Enable the table for Supabase Realtime `INSERT` events and configure row-level security policies for the gallery's intended access.
5. Run `npm run dev` and open the local URL printed by Vite.

Without valid Supabase settings, the app displays a configuration message rather than making requests to placeholder credentials. Set `VITE_INSTAGRAM_HANDLE` to change the gallery footer profile; the default is `vaglan_clicks`. Run `npm run lint` and `npm run build` to check the frontend.

## Payments

Checkout is intentionally disabled until a trusted payment backend is configured. The browser must not mark an order paid or calculate a charge as authoritative; payment creation and verification must happen on a server.
