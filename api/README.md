# SIMMAM API (minimal scaffold)

This folder contains a minimal Express + TypeScript scaffold that uses the Supabase Service Role key to perform server-side operations.

Prereqs:
- Node 18+
- A Supabase project with the schema from `../supabase/schema.sql` applied

Running locally:

1. Copy `.env.example` to `.env` and fill in keys.
2. Install deps: `npm install` (run inside `api` folder)
3. Start dev server: `npm run dev`

Endpoints (examples):
- `GET /api/health` — health check
- `GET /api/events` — list events
- `POST /api/registrations` — create registration. Body: `{ email, name, register_number, house, event_id }`
- `GET /api/users/:email/registrations` — list a user's registrations

Notes:
- This is a minimal starting point. You should add proper validation, authentication for admin endpoints, rate-limiting, and logging before production.

Render deployment (Blueprint):

1. Keep `render.yaml` in the repository root.
2. In Render, click New > Blueprint and connect this repository.
3. Render will detect `render.yaml` and create the `simmam-api` web service using the `api` folder as root.
4. Set required secrets in Render:
	- `SUPABASE_URL`
	- `SUPABASE_SERVICE_ROLE`
5. Set optional variables if used in your environment:
	- `SUPABASE_ANON_KEY`
	- `FRONTEND_URL`
	- `REDIS_URL`
	- `SENTRY_DSN`
6. Verify health endpoint after deploy:
	- `GET /api/health`
