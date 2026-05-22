# Sentry setup (frontend + API)

This project already initializes Sentry in:
- `src/instrument.ts` (frontend)
- `api/src/instrument.ts` (backend)

This guide covers environment variables, release mapping, sourcemaps, and validation.

## 1) Create two Sentry projects

Use separate projects:
- Web (frontend)
- API (backend)

Collect:
- Project DSNs
- `SENTRY_ORG`
- `SENTRY_AUTH_TOKEN`
- Project slugs (`SENTRY_PROJECT_WEB`, `SENTRY_PROJECT_API`)

## 2) Configure runtime environment variables

### Frontend (Vercel)

Set:
- `VITE_SENTRY_DSN`
- `VITE_SENTRY_ENVIRONMENT` (example: `staging` or `production`)
- `VITE_SENTRY_RELEASE` (set to commit SHA during CI/deploy)
- `VITE_SENTRY_TRACES_SAMPLE_RATE` (example: `0.1`)

### API (Railway/Render/Fly)

Set:
- `SENTRY_DSN`
- `SENTRY_ENVIRONMENT` (example: `staging` or `production`)
- `SENTRY_RELEASE` (set to commit SHA during CI/deploy)
- `SENTRY_TRACES_SAMPLE_RATE` (example: `0.1`)

## 3) CI secrets (GitHub)

Add these repository secrets:
- `SENTRY_AUTH_TOKEN`
- `SENTRY_ORG`
- `SENTRY_PROJECT_WEB`
- `SENTRY_PROJECT_API`

`ci-cd.yml` now uploads sourcemaps for both frontend and API on `main`.

## 4) Local smoke validation

Run app and trigger one frontend + one API error in staging/local.

### API test endpoint check

Use a temporary throw or existing failure path, then verify event appears in Sentry API project.

### Frontend check

From browser console:

```javascript
throw new Error('Sentry frontend test event')
```

Confirm it appears in Sentry Web project with symbolicated stack traces.

## 5) Recommended alert rules

Create alerts per environment:
- New issue in `production`
- Error count spike over 5 minutes
- API failure-rate threshold (e.g. > 2%)
- p95 transaction latency threshold for critical endpoints

## 6) Release hygiene

- Keep release value equal to git SHA across frontend + API.
- Never reuse release IDs.
- Ensure sourcemaps are uploaded from CI for every main deployment.

## Notes

- Frontend sourcemaps are enabled in `vite.config.ts`.
- API sourcemaps are enabled in `api/tsconfig.json`.
- If you change build output paths, update sourcemap upload paths in `.github/workflows/ci-cd.yml`.
