Production deployment checklist

1) Prepare staging environment
- Create staging DB and restore a recent backup from production.
- Configure staging env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE, VITE_* keys, REDIS_URL, SENTRY_DSN, CLOUDFLARE_TURNSTILE_SECRET.

2) Apply safer DB migration to staging
- Run:
```
PGSSLMODE=require psql "$STAGING_DB_URL" -f supabase/migrations/20260521_safer_create_registration.sql
```
- Verify:
  - `select proname, proacl from pg_proc where proname like 'create_registration%';`
  - `select registrations_count from events where id = '<sample-event-id>'` and compare capacity.

3) Deploy backend to staging
- Build and start the API with `SUPABASE_SERVICE_ROLE` set in env.
- Ensure `REDIS_URL` set for production-scale rate-limiting.
- Health check: `curl -I https://<api-host>/api/health`

4) Deploy frontend to staging
- Ensure only `VITE_*` anon keys are provided.
- Build the site: `npm run build` and confirm no `SERVICE_ROLE` in output.

Cloudflare Pages
- If you use Cloudflare Pages, set the following GitHub secrets to enable CI deploys from `main`:
  - `CF_PAGES_API_TOKEN` — A Pages API token with `Pages` deploy permissions.
  - `CF_ACCOUNT_ID` — Your Cloudflare account ID.
  - `CF_PROJECT_NAME` — The Pages project name (slug).
- In the workflow, set `DEPLOY_CLOUDFLARE=true` in the environment to trigger Pages deployment.

Cloudflare WAF, Rate-limits and Turnstile at edge
- Configure Cloudflare WAF rules to block common bot / SQLi / XSS payloads.
- Add Rate Limiting for the registration and login endpoints (e.g., 10 reqs per minute per IP for registration).
- Deploy the `cloudflare/turnstile-worker.js` Worker and route your registration POST path through it. Store Turnstile secret as a Worker secret named `TURNSTILE_SECRET` or configure via Pages environment variables.

Staging test automation
- The CI `staging-deploy` job can run smoke tests and load tests before or after deployment. Set these env vars in the workflow or GitHub Actions UI:
  - `STAGING_URL` — base URL of staging API/frontend
  - `RUN_SMOKE=true` — run Newman Postman smoke tests
  - `RUN_LOAD=true` — run k6 load tests

Secrets for staging
- `STAGING_DB_URL`, `STAGING_DB_PASSWORD` for applying migrations (use read-only where possible),
- `REDIS_URL` for staging Redis (Upstash TLS URL or managed Redis),
- `CF_PAGES_API_TOKEN`, `CF_ACCOUNT_ID`, `CF_PROJECT_NAME` for Cloudflare Pages deploy,
- `TURNSTILE_SECRET` for Turnstile verification (Worker secret or Pages env var),
- `SENTRY_DSN` / `VITE_SENTRY_DSN` / `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT_*` for Sentry.

5) Functional tests (staging)
- Sign in as admin and user, verify /api/wch1925 routes enforce admin role.
- Create single registration and verify registration_count increments and ticket is generated.
- Attempt duplicate registration (expect error).

6) Load tests (staging)
- Run k6 script (see `load-tests/k6-registration-test.js`) with a valid token.
- Observe no oversells and acceptable p95 latency.

7) Security hardening
- Ensure `create_registration_safe` has `EXECUTE` only for `service_role`.
- Enforce Turnstile on registration and admin login forms.
- Use Redis for rate limiting and remove in-memory fallback.
- Rotate sensitive keys and ensure CI secrets are set securely.

8) Observability
- Configure Sentry for frontend and API.
- Follow detailed setup in `docs/SENTRY_SETUP.md`.
- Export basic metrics: request count, errors, p95 latency.
- Set alerting thresholds.

9) CI/CD
- Configure Action secrets: STAGING_DB_URL, PROD_DB_URL, SUPABASE_SERVICE_ROLE (use only for API deploy steps), REDIS_URL, SENTRY_DSN.
- Require manual approval for production migration/deploy.

10) Production rollout
- Backup production DB.
- Apply migrations to production (manual approved step).
- Deploy API and Frontend to production.
- Monitor for 30–60 minutes, verify health and metrics.

Rollbacks
- Restore DB from backup if migration shows issues.
- Re-deploy previous service image if runtime errors surface.
