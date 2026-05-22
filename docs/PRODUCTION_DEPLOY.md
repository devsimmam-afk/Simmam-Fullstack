Production deployment checklist

1) Prepare staging environment
- Create staging DB and restore a recent backup from production.
- Configure staging env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE`, and `VITE_*` keys (frontend should only receive anon keys). Integrations such as Redis, Sentry, and Cloudflare Turnstile are optional and not required for a basic deployment.

2) Apply safer DB migration to staging
- Run:
```
PGSSLMODE=require psql "$STAGING_DB_URL" -f supabase/migrations/20260521_safer_create_registration.sql
```
- Verify permissions and registration counts as needed.

3) Deploy backend to staging
- Build and start the API with `SUPABASE_SERVICE_ROLE` set in env.
- Health check: `curl -I https://<api-host>/api/health`

4) Deploy frontend to staging
- Ensure only `VITE_*` anon keys are provided to the frontend.
- Build the site: `npm run build` and confirm no server-only secrets are leaked.

Notes on optional integrations
- Cloudflare Pages / WAF / Turnstile: optional. If used, configure Cloudflare per your needs; the app can run without Cloudflare features.
- Redis / Upstash: optional. This repo now defaults to in-memory rate limiting and caching for single-instance deployments.
- Sentry / observability: optional. Remove these integrations if you prefer a minimal deployment.

5) Functional tests (staging)
- Sign in as admin and user, verify routes enforce admin role.
- Create a registration and verify counts and tickets.

6) Load tests (staging)
- Run k6 scripts in `load-tests/` if required.

7) Security hardening
- Ensure `create_registration_safe` has `EXECUTE` only for `service_role`.
- Configure additional protections (WAF, rate limits) if you enable them.

8) Observability
- Add metrics and error reporting only if you opt into Sentry or other monitoring.

9) CI/CD
- Configure Action secrets: `STAGING_DB_URL`, `PROD_DB_URL`, `SUPABASE_SERVICE_ROLE` (use only for API deploy steps). Additional secrets for optional integrations can be added later.

10) Production rollout
- Backup production DB.
- Apply migrations to production (manual approved step).
- Deploy API and Frontend to production.
- Monitor health and metrics after rollout.

Rollbacks
- Restore DB from backup if migration shows issues.
- Re-deploy previous release if runtime errors surface.
