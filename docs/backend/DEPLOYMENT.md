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
- **Logs:** uvicorn runs with `--no-access-log` (the `Dockerfile` `CMD` has it since Phase 11B; the app's structured request log replaces it) or strip query strings on `/api/v1/auth/oauth/*`; the same for reverse-proxy access logs. Never ship request/response bodies or `Cookie`/`Set-Cookie` headers to logs.
- **Secrets** (from the host's secret store, never committed): `GOOGLE_OAUTH_CLIENT_SECRET` (the client id is not secret but is configured the same way), email-provider credentials, `DATABASE_URL`. There is deliberately **no session secret or JWT key**. Settings validation fails fast in staging/production if `AUTH_COOKIE_SECURE` is false, the email backend is `console`, or `FRONTEND_BASE_URL` is not an allowed origin.
- **Scheduled maintenance (implemented):** run `python -m app.cli.auth_maintenance purge` periodically (daily) from the host's scheduler; it is a safety-net sweep (login already deletes a user's own expired sessions; expired sessions have no retention guarantee), prints how many rows it removed, is idempotent, and correctness never depends on it.
- **Bootstrap runbook (implemented):** register normally, verify the email, then run `python -m app.cli.admin grant <email>` with `DATABASE_URL` pointing at the target database (audited; revokes that user's sessions; `revoke <email>` removes the role). There is no public admin signup and no HTTP endpoint for roles.
- **Email delivery** is `disabled` in staging/production until a provider is implemented (settings refuse `console`/`memory` there): verification and reset emails are not delivered yet, so enabling real sign-ups needs the provider and the custom domain first.
- **Caching:** the API's `/auth/*` responses are `Cache-Control: no-store`; do not add CDN caching rules that ignore it.

## 10. Google sign-in (Phase 11C)

The backend does the whole OpenID Connect flow (`AUTH_RBAC.md` §10, §21); Google only tells it *who* the user is. Nothing here is needed for development or CI — `GOOGLE_OAUTH_PROVIDER=fake` runs the complete flow in-process, with no network and no credentials.

**Environment (per environment; the secret only from the host's secret store):**

| Variable | Value |
|---|---|
| `GOOGLE_OAUTH_PROVIDER` | `google` (`disabled` by default; `fake` is development/test only and refused in staging/production) |
| `GOOGLE_OAUTH_CLIENT_ID` | the OAuth client id from Google Cloud |
| `GOOGLE_OAUTH_CLIENT_SECRET` | the OAuth client secret — a secret: never in git, an image, a log or the SPA |
| `API_PUBLIC_BASE_URL` | the public base URL of the API as the browser sees it, e.g. `https://api.b17portal.pk` (`https` required when hosted; no path) |
| `FRONTEND_BASE_URL` / `FRONTEND_ORIGINS` | unchanged: the callback redirects the browser here |

**Google Cloud setup (Google Cloud Console → APIs & Services):**

1. **OAuth consent screen:** user type *External*; app name (e.g. "B-17 Portal"), support email, developer contact email; **scopes** only the non-sensitive `openid`, `email`, `profile` (no verification review is needed for these; add nothing else); keep the app in *Testing* with named test users while trialling, then *Publish* it for general use. Add the privacy-policy and terms URLs before publishing.
2. **Credentials → Create credentials → OAuth client ID → application type "Web application"** (a *confidential* client — not "Desktop", not "Android/iOS", not a SPA/implicit client).
3. **Authorized redirect URI** — exactly one per environment, character for character:
   `{API_PUBLIC_BASE_URL}/api/v1/auth/oauth/google/callback`
   - development smoke: `http://127.0.0.1:8000/api/v1/auth/oauth/google/callback` (Google permits `http` for loopback; use `127.0.0.1` for **both** the frontend and the API and never mix in `localhost` — cross-site cookies would not be sent)
   - production: `https://api.<your-domain>/api/v1/auth/oauth/google/callback`
   Leave *Authorized JavaScript origins* empty: the browser never calls Google from JavaScript.
4. Copy the client id and secret into the host's secret store. Rotate the secret on suspicion of exposure (create a new one, deploy, delete the old).

**Go-live prerequisites (still open, unchanged by 11C):** a **custom domain** that makes the frontend and API same-site (`§9`), a **production email provider** (verification and reset mail; Google users created with an unverified Google email need it), edge **per-IP rate limiting** on `/api/v1/auth/*` including `oauth/google/start` and `…/callback`, and access-log query-string stripping on `/api/v1/auth/oauth/*` (the callback URL carries the one-time `code` and `state`).

**Real-Google smoke checklist (manual; not part of CI):** with a *Testing*-mode consent screen and your own Google account as a test user: set the three variables above; `POST /api/v1/auth/oauth/google/start` from the allowed origin → open `authorizationUrl` → consent → expect a `302` to the frontend with the `b17_session` cookie set and `GET /auth/me` showing `authMethods.providers: ["google"]`; repeat the sign-in (expect a login, no new account); start a second flow and replay the callback URL (expect `/login?error=oauth_failed`); sign in with a *different* Google account whose email matches a verified password account (expect `/login?error=identity_conflict`), sign in to that account and *Connect Google*; finally *Disconnect* and confirm the last-method guard. No test in the repository performs these steps.

## 11. Maps and location operations (Phase 12A requirements; design in `LOCATION_MAP.md`)

Nothing here is implemented in 12A; it records what deployment must provide when slices 12B and 12G land.

| Setting | Where | Meaning |
|---|---|---|
| `LOCALITIES` | API environment (default `B-17`) | The canonical locality list that a new listing's `area` must belong to (`LOCATION_MAP.md` §4). Mirrored by the frontend config until a managed lookup exists. **There is no geofence setting**: only latitude `-90..90` / longitude `-180..180` are validated; B-17 geofencing waits for authoritative geographic data (`LOCATION_MAP.md` §5). |
| `VITE_MAP_TILE_URL` · `VITE_MAP_TILE_ATTRIBUTION` | frontend build | The raster tile template and its required attribution. Dev / demo default: standard OpenStreetMap tiles. **Production must set a compliant provider.** |
| `VITE_MAP_DEFAULT_CENTER` | frontend build | Picker start position (`lat,lng`; falls back to a labelled Islamabad city centre). It is a starting view, not a limit. |

- **Tile provider.** The public OpenStreetMap tile servers are for light development and demo use under the OSM Tile Usage Policy (attribution, identification through a valid `Referer`, no bulk or offline downloading); they are not a production CDN and may block heavy traffic. For production choose, at deployment time, either a commercial tile service (check its terms, attribution and quota) or self-hosted tiles. No provider is chosen or priced here; swapping is a build-time configuration change. Tile requests are cross-origin, so the service worker never caches them (keep it that way).
- **No API key for Get Directions.** The directions link is a plain `https://www.google.com/maps/dir/?api=1&destination=…` URL; it needs no Google Cloud project and is unrelated to the Google OAuth client of §10.
- **Referrer policy.** Keep `Referrer-Policy: no-referrer` on `/verify-email` and `/reset-password`; set a standard policy (`strict-origin-when-cross-origin`) for the rest of the site so tile servers that require a referrer work. Configure this per route in the host / reverse proxy.
- **CSP.** None exists today. If one is introduced, `img-src` must include only the configured tile host (plus `self` and `data:` for inline icons) and `connect-src` the API origin.
- **Upgrading an existing database to `0005`.** `alembic upgrade head` (DDL only, no data change; it rewrites `listings` once to compute the generated columns — run it in the normal migration window) → for dev / staging `python -m scripts.dev_fixtures` (idempotent; applies the explicit demo-location step to fixture ids only; refuses production) → `python -m app.db.search_index check` (no rebuild needed for existing rows). Existing listings become area-level legacy rows; nothing is inferred (`LOCATION_MAP.md` §3.1).
- **Privacy in logs.** The request log records no bodies or query strings, so coordinates never reach it; do not add proxy-level body logging for `/api/v1/listings`.
