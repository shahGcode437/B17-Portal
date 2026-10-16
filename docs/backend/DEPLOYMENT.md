# B-17 Portal — Deployment & Environments

**Status:** direction frozen by Phase 10A — **provider-neutral; no hosting provider is chosen and no Docker/CI/infra files exist yet.**
**Owns:** environment strategy, local development direction (Docker/Compose), database and migration operations, hosting requirements, backups, secrets and HTTPS.
**Does not own:** application layering/config variables → [`BACKEND_ARCHITECTURE.md`](BACKEND_ARCHITECTURE.md) · auth/session design → [`AUTH_RBAC.md`](AUTH_RBAC.md) · object storage specifics → [`MEDIA_STORAGE.md`](MEDIA_STORAGE.md).

## 1. Environments

| Environment | Purpose | Database | Data |
|---|---|---|---|
| **local** | Day-to-day development | Local Postgres (Docker Compose or a native install) | Seeded demo/dev fixtures |
| **test** | Automated tests / CI | Dedicated **test** database, rebuilt from migrations; never shared with any other environment | Per-test fixtures |
| **staging** | Pre-production verification, full-stack Playwright | Managed Postgres (separate instance) | Fixed-UUID fixtures; `noindex` (`VITE_SITE_NOINDEX=true`) |
| **production** | Real users | Managed Postgres | Real data; **no demo fixtures** unless a product decision says otherwise (`DATA_MODEL.md` O-4) |

Each environment has its own database, secrets, storage bucket and allowed CORS origins. Configuration is by environment variables only (`BACKEND_ARCHITECTURE.md` §7); nothing environment-specific is baked into images or committed.

## 2. PostgreSQL assumptions

- A currently supported PostgreSQL major version; extensions required: `pg_trgm` (substring search), plus `citext`/`pgcrypto` only if chosen in 10C. PostGIS is *not* required now.
- **Managed PostgreSQL preferred in production** (automated backups, patching, point-in-time recovery, monitoring, failover) over self-managed.
- **Two database roles:** a *migration* role (DDL, used only by the release step) and a *runtime* role (DML only, least privilege) — the application can never alter the schema.
- Network access is restricted to the backend (private networking/allow-list); the database is never exposed publicly; TLS to the database where the provider supports it.
- Connection pooling sized to the API's worker count; a pooler (e.g. provider-side) only when connection counts demand it.

## 3. Local development (Docker direction)

Implemented in Phase 10C:

- **Docker Compose** provides PostgreSQL (and, optionally, the API container). `docker compose up db` is enough to develop; the API and tests can also run directly on the host.
- The **Vite frontend stays host-run**. Docker is not required for frontend work, for running backend **unit** tests, or for any command that does not need a database.
- The API `Dockerfile` (`backend/Dockerfile`) is a single-stage `python:3.12-slim` image: third-party runtime dependencies are installed from `pyproject.toml` in their own cached layer, no dev tools or tests are copied in, it runs as a non-root user (`b17`, uid 10001), has no `.env`, defaults to `ENVIRONMENT=production`, and has a liveness `HEALTHCHECK`. Migrations are **not** run on boot: `docker run --rm -e DATABASE_URL=… <image> alembic upgrade head` is the release step.
- `.env.example` documents every variable with safe placeholders; the real `.env` is git-ignored. A separate `TEST_DATABASE_URL` is mandatory for tests, and the test harness refuses to run against anything else.
- Local CORS allows the explicit dev origins listed in `BACKEND_ARCHITECTURE.md` §7 (`localhost`/`127.0.0.1` on 5173 and the 4173 preview origin used by E2E); for authentication work use `127.0.0.1` for both frontend (`:5173`) and API (`:8000`) and do not mix in `localhost` (`AUTH_RBAC.md` §5.1).

## 4. Migrations in operations

- Alembic migrations are applied as an **explicit release step** (before the new app version takes traffic), using the migration role — not implicitly on app boot in production.
- Backward-compatible (expand → migrate → contract) changes so the previous app version keeps working during the rollout; destructive steps ship in a later release.
- Every migration is reviewed; a failed migration blocks the release. Take/confirm a fresh backup before schema changes that rewrite data.
- Never run ad-hoc DDL on staging/production. Reference data (e.g. initial categories) is loaded by an idempotent script, not by hand.

### 4.1 Upgrading a populated database to Phase 10D (migration `0002`) — required reindex

Migration `0002_search_foundation` adds `listings.search_document` with an empty default, so listings that already exist are **not searchable until their documents are built**. This is a required, one-time data step for every database that already holds listings (staging, production, a long-lived dev database). Run, in this order, as part of the release (release environment, before the new version takes traffic):

```bash
alembic upgrade head
python -m app.db.search_index rebuild     # fills search_document for every existing listing (idempotent)
python -m app.db.search_index check       # must print "all documents are current" (exit 0)
```

* `check` exits `1` and lists the stale ids while any document is missing or out of date; run it any time you suspect drift.
* A fresh database, or one filled by `python -m scripts.dev_fixtures`, already has complete documents (the creation service and the fixtures index as they write). That must not be mistaken for "no reindex is ever needed": a **populated** database always needs the rebuild.
* The rebuild is deliberately **not** run on API startup (it is an O(listings) write; migrations and data steps are explicit release steps). Re-running it is safe.
* The path is covered by an automated test that creates listings at revision `0001`, upgrades to `0002`, shows the audit failing and search returning nothing, rebuilds, and then finds the old listings (`backend/tests/db/test_search_upgrade_path.py`).


## 5. Hosting requirements (provider-neutral)

- **Frontend:** static hosting for the Vite build with **HTTPS** and an **SPA fallback** (every unknown path serves `index.html` — currently missing: direct links/refresh would 404 on a plain static host; recorded in `CURRENT_STATE.md`), correct cache headers (hashed assets immutable; `index.html` and `sw.js` revalidated), and the PWA requirements already met (manifest, service worker scope `/`). The production URL feeds `VITE_SITE_URL`; staging sets `VITE_SITE_NOINDEX=true`.
- **Backend:** any container-capable platform (managed containers, PaaS, VM + reverse proxy). Needs: HTTPS termination, health probes (`/api/v1/health`, `/health/ready`), horizontal scaling by running more identical containers (stateless API), graceful shutdown, log shipping from stdout (structured JSON).
- **Topology:** prefer **same-site** frontend and API (shared registrable domain, or the API reverse-proxied under `/api`) so cookie-based sessions remain first-party (the Phase 11A decision, `AUTH_RBAC.md` §5.1). CORS lists the exact deployed origin(s) only.
- **Object storage:** any S3-compatible service (`MEDIA_STORAGE.md`); bucket CORS limited to the frontend origin.
- **Region/latency:** pick regions near B-17/Islamabad users where possible; the frontend is a PWA and tolerant of latency, but the DB and API should be co-located.

## 6. Secrets, HTTPS, backups

- **Secrets** (DB URLs, signing keys, OAuth client secrets, storage credentials) live in the platform's secret store/environment, are injected at runtime, rotated on a schedule and on suspected exposure, and are never committed, logged or baked into images. Use distinct secrets per environment.
- **HTTPS everywhere** in staging and production (HSTS on the frontend/API domains); no mixed content; cookies `Secure` if used.
- **Backups:** automated daily backups plus point-in-time recovery for the production database; retention defined by the product owner; **restore is tested** on a schedule (an untested backup is not a backup); object storage versioning/replication as the provider allows.
- **Monitoring** (later): uptime check on the health endpoints, DB metrics from the managed provider, error alerts via the log pipeline; Sentry/OpenTelemetry/Prometheus are optional later additions (`BACKEND_ARCHITECTURE.md` §7).

## 7. CI/CD direction

Existing frontend CI (`.github/workflows/frontend-ci.yml`) is unchanged. Backend CI (`.github/workflows/backend-ci.yml`) runs ruff, ruff format check and mypy (strict), then — against a disposable PostgreSQL 17 **service container** with throw-away credentials that exist only inside the job — creates the `_test` database, `alembic upgrade head` on a fresh database, `alembic check` (model/migration drift), the reference seed **twice** (idempotency), and `pytest` (with `CI` set, so the PostgreSQL suite can never be silently skipped). A second job builds the API image (never pushed). Deployment automation is a separate, later decision (no provider chosen); production deploys require the CI gates plus a manual approval and the migration step above.

## 8. Not decided here

Hosting provider(s) and pricing tier · domain names · email-sending provider · CDN · observability vendor · backup retention numbers · autoscaling policy · multi-region/DR. Each is an operational decision for the deployment phase and must respect §1–§6.

## 9. Authentication operations (Phase 11A requirements; details in `AUTH_RBAC.md`)

- **Topology prerequisite:** the frontend and API must be **same-site** — `https://b17portal.pk` + `https://api.b17portal.pk`, or one origin with `/api` reverse-proxied. Different registrable domains would need `SameSite=None` third-party cookies and are not supported. Provider-default hostnames on the Public Suffix List (`*.vercel.app`, `*.onrender.com`, …) are *cross-site* to each other, so a **custom domain is required before auth is enabled** in staging/production (`AUTH_RBAC.md` §5.1). No hosting provider is chosen here.
- **TLS everywhere:** the session cookie is `Secure` (and `__Host-` prefixed) in staging/production; terminate HTTPS before the API and send `HSTS`.
- **Proxy/IP handling:** per-IP rate limiting belongs at the **edge** (reverse proxy/CDN/WAF): login, register, forgot-password, resend-verification, OAuth start/callback. The app does not trust `X-Forwarded-For` unless a trusted-proxy setting is configured, and uses PostgreSQL counters only for identity-keyed limits.
- **Logs:** run uvicorn with `--no-access-log` (the app's request log replaces it; the current `Dockerfile` `CMD` does not yet — a Phase 11B change) or strip query strings on `/api/v1/auth/oauth/*`; the same for reverse-proxy access logs. Never ship request/response bodies or `Cookie`/`Set-Cookie` headers to logs.
- **Secrets** (from the host's secret store, never committed): `GOOGLE_OAUTH_CLIENT_ID/SECRET` (11C), email-provider credentials, `DATABASE_URL`. There is deliberately **no session secret or JWT key**. Settings validation fails fast in staging/production if `AUTH_COOKIE_SECURE` is false, the email backend is `console`, or `FRONTEND_BASE_URL` is not an allowed origin.
- **Scheduled maintenance:** run `python -m app.cli.auth_maintenance purge` periodically (daily) from the host's scheduler; correctness never depends on it.
- **Bootstrap runbook:** the first admin is created by an operator: register normally, verify the email, then run `python -m app.cli.admin grant <email>` against the production database (audited; revokes that user's sessions). There is no public admin signup.
- **Caching:** the API's `/auth/*` responses are `Cache-Control: no-store`; do not add CDN caching rules that ignore it.
