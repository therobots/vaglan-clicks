# Project Guidelines

## Architecture

- This is a public React/Vite single-page photo gallery. `src/main.jsx` mounts `src/App.jsx`.
- Supabase configuration comes only from `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; never expose a service-role key in frontend code.
- The public gallery uses the `?album=` query parameter to scope sessions. Anonymous gallery listings and filters use album-scoped `gallery_*` RPCs. Any other public gallery query, including visibility reconciliation, must also be scoped to the selected album.
- Gallery previews are private Storage objects. Public images must go through `/api/preview`, which checks album, visibility, expiry, and baked watermark on every request; never return raw Storage URLs to public gallery components. `SUPABASE_SERVICE_ROLE_KEY` is server-only in Vercel and Edge Functions. Original-photo access, Viva Wallet payment creation and verification, and signed download URL generation stay in the `create-viva-order`, `viva-webhook`, and `order-downloads` Edge Functions.
- Checkout runs through Viva Wallet and must continue to use trusted server-side order totals and payment verification.
- Ordinary admin deletion must refuse photos with paid orders. Privacy erasure through a pending removal request records affected paid items so the download page does not offer broken links; customer remedy is an operator decision.

## Development and validation

- Follow `README.md` for setup and Supabase configuration.
- Use `npm run dev` for local frontend development.
- Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` for relevant changes.
