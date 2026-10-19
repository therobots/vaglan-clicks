# Project Guidelines

## Architecture

- This is a public React/Vite single-page photo gallery. `src/main.jsx` mounts `src/App.jsx`.
- Supabase configuration comes only from `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; never expose a service-role key in frontend code.
- The browser reads public photo previews. Original-photo access and payment verification must stay server-side.
- Checkout remains disabled until a trusted payment backend is configured.

## Development and validation

- Follow `README.md` for setup and Supabase configuration.
- Use `npm run dev` for local frontend development.
- Run `npm run lint`, `npm run typecheck`, and `npm run build` for relevant changes.
