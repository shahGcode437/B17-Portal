# B-17 Portal — Deployment & Environments

**Status:** direction frozen by Phase 10A — **provider-neutral; no hosting provider is chosen and no Docker/CI/infra files exist yet.**
**Owns:** environment strategy, local development direction (Docker/Compose), database and migration operations, hosting requirements, backups, secrets and HTTPS.
**Does not own:** application layering/config variables → [`BACKEND_ARCHITECTURE.md`](BACKEND_ARCHITECTURE.md) · auth/session design → [`AUTH_RBAC.md`](AUTH_RBAC.md) · object storage specifics → [`MEDIA_STORAGE.md`](MEDIA_STORAGE.md).

## 1. Environments

| Environment | Purpose | Database | Data |
|---|---|---|---|
| **local** | Day-to-day development | Local Postgres (Docker Compose or a native install) | Seeded demo/dev fixtures |
| **test** | Automated tests / CI | Dedicated **test** database, rebuilt from migrations; never shared with any other environment | Per-test fixtures |
| **staging** | Pre-production verification, full-stack Playwright | Managed Postgres (separate instance) | Fixed-UUID fixtures *(RBAC freeze, 2026-11-19: development fixtures, including the fixture admin, are to be refused in staging, which seeds no staff identity — a staging Super Admin is provisioned explicitly through the staff CLI; `AUTH_RBAC.md` §27.14; planned for RBAC-H, today the loader refuses only `production`)*; `noindex` (`VITE_SITE_NOINDEX=true`) |
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
- **Bootstrap runbook (implemented):** register normally, verify the email, then run `python -m app.cli.staff promote-super-admin <email> --reason "first Super Admin"` with `DATABASE_URL` pointing at the target database (a reason of 10 to 500 characters is mandatory; audited with `source = cli`; revokes that user's sessions; `demote-super-admin <email> --reason ...` removes the role and is refused for the last usable Super Admin). The target must be an active, verified account with a sign-in method that works right now (a password, or a linked identity whose provider is enabled — with Google sign-in off a Google-only account is not usable and is neither counted nor promotable); run the CLI with the same environment as the API; in staging / production a fixture, demo or reserved-domain address is refused. The normal target is 2 usable Super Admins: a third needs `--override-policy`, one above `SUPER_ADMIN_SAFETY_CEILING` (default 3) needs `--break-glass`, and `--break-glass` is also how an operator documents a recovery from zero. `python -m app.cli.admin grant|revoke` still works as a deprecated wrapper (it now also needs `--reason`). There is no public admin signup, no HTTP endpoint that promotes or demotes a Super Admin, and Moderators are appointed through the Super Admin staff API (`AUTH_RBAC.md` §30).
- **Planned hardening (RBAC-0 freeze, 2026-11-19; NOT implemented — `AUTH_RBAC.md` §27):** `admin` will mean Super Admin (1–2 accounts operationally; never zero usable), promotion and demotion will stay CLI-only through a shared authority service that requires a reason, is audited and revokes the target's sessions, and hosted grants will reject fixture, demo and reserved-TLD identities. A scoped `moderator` role is planned beside it (the two roles are mutually exclusive). **Before PUBLIC production, every Super Admin and every Moderator must have MFA** (no production staff bypass; any bypass is explicit and development-only), and development fixtures and demo staff identities must not exist in staging or production: staging seeds no staff identity, and a staging Super Admin is provisioned explicitly through the staff CLI from an active, verified account on an approved, controlled staging / test domain or account.
- **Email delivery** (EMAIL-1, §13): a Resend adapter exists. Staging/production stay `disabled` until `EMAIL_BACKEND=resend` is configured with a verified sending domain; real delivery has been accepted **only locally through the Resend sandbox** (§13.5), so enabling real sign-ups still needs the verified domain, production credentials, the §13.6 requirements and the custom domain.
- **Caching:** the API's `/auth/*` responses are `Cache-Control: no-store`; do not add CDN caching rules that ignore it.

## 10. Google sign-in (Phase 11C; local setup and diagnostics added in GOOGLE-AUTH-1)

The backend does the whole OpenID Connect flow (`AUTH_RBAC.md` §10, §21); Google only tells it *who* the user is. Nothing here is needed for CI or for ordinary development: Google sign-in is **`disabled` by default**, so the start endpoint answers `503` and the button says "Google sign-in isn't available right now". `GOOGLE_OAUTH_PROVIDER=fake` runs the complete flow in-process, with no network and no credentials.

**Environment (per environment; the secret only from the host's secret store):**

| Variable | Value |
|---|---|
| `GOOGLE_OAUTH_PROVIDER` | `google` (`disabled` by default; `fake` is development/test only and refused in staging/production) |
| `GOOGLE_OAUTH_CLIENT_ID` | the OAuth client id from Google Cloud |
| `GOOGLE_OAUTH_CLIENT_SECRET` | the OAuth client secret — a secret: never in git, an image, a log or the SPA |
| `API_PUBLIC_BASE_URL` | the public base URL of the API as the browser sees it (`https` required when hosted; no path). Development default `http://127.0.0.1:8000` |
| `FRONTEND_BASE_URL` / `FRONTEND_ORIGINS` | where the callback sends the browser. Development default `http://127.0.0.1:5173`. When both URLs are loopback they must use the **same** host name (settings refuse to start otherwise: cookies are host-only) |

**Google Cloud setup (Google Cloud Console → Google Auth Platform, formerly "APIs & Services → OAuth consent screen / Credentials"):**

1. **Consent screen** (*Branding* + *Audience*): user type *External*; app name (e.g. "B-17 Portal"), support email, developer contact email. **Scopes** (*Data access*): only `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile` — all non-sensitive; add nothing else. While the publishing status is *Testing*, only the accounts listed under **Test users** can sign in: add every account you will test with. *Publish* it for general use; add the privacy-policy and terms URLs first (publishing a branded app can require Google's brand verification).
2. **Clients → Create client → application type "Web application"** (a *confidential* client — not "Desktop", not "Android/iOS", not a SPA/implicit client). Use a **separate client per environment**.
3. **Authorized redirect URI** — exactly one per environment, character for character (no trailing slash), `{API_PUBLIC_BASE_URL}/api/v1/auth/oauth/google/callback`:
   - local development: `http://127.0.0.1:8000/api/v1/auth/oauth/google/callback` (Google permits `http` for loopback). It is the **API's** port 8000, not the Vite port. Register `127.0.0.1` exactly: `localhost` is a different string to Google and a different cookie host to the browser.
   - production (`b17portal.com`): `https://api.b17portal.com/api/v1/auth/oauth/google/callback`
4. **Authorized JavaScript origins: leave empty.** This is a server-side authorization-code flow; the browser never calls Google from JavaScript.
5. Copy the client id and secret into `backend/.env` locally (git-ignored) or the host's secret store. Rotate the secret on suspicion of exposure (create a new one, deploy, delete the old).

### 10.1 Local development

In `backend/.env` set these three (the two base URLs already have the right development defaults):

```
GOOGLE_OAUTH_PROVIDER=google
GOOGLE_OAUTH_CLIENT_ID=<from Google Cloud>
GOOGLE_OAUTH_CLIENT_SECRET=<from Google Cloud>
```

**Restart the API** (settings are read once at startup), running it from `backend/` so that this `.env` is the one loaded: `uvicorn app.main:app --host 127.0.0.1 --port 8000`. Then open **`http://127.0.0.1:5173`**. The rest of the app also works at `localhost:5173`, but a Google round trip cannot: the browser-binding cookie set by `start` belongs to `localhost` and is not sent to the `127.0.0.1` callback. The sign-in button detects this and links to the `127.0.0.1` page instead of starting a flow that would end in `oauth_failed`.

### 10.2 Production (`b17portal.com` + `api.b17portal.com`; not deployed yet)

| Where | Setting |
|---|---|
| API | `ENVIRONMENT=production`, `GOOGLE_OAUTH_PROVIDER=google`, the production client id and secret (secret store), `API_PUBLIC_BASE_URL=https://api.b17portal.com`, `FRONTEND_BASE_URL=https://b17portal.com`, `FRONTEND_ORIGINS=https://b17portal.com` (redirect `www` to the apex, or add it to `FRONTEND_ORIGINS`) |
| Frontend **build** | `VITE_API_BASE_URL=https://api.b17portal.com/api/v1` (without it the SPA calls its own origin) |
| Google Cloud | a production Web client; redirect URI `https://api.b17portal.com/api/v1/auth/oauth/google/callback`; no JavaScript origins; consent screen *Published*, with `b17portal.com` as an authorized domain and the privacy-policy and terms URLs |

The two hosts are same-site, so the `SameSite=Lax` host-only cookies (`__Host-b17_oauth`, `__Host-b17_session`, both set by `api.b17portal.com`) travel on the SPA's credentialed requests; CORS with credentials is already on for exact origins.

**Go-live prerequisites (still open):** the **production OAuth configuration** in the table above (not done; the local client must not be reused), the **custom domain** above (`§9`), a **production email provider** (verification and reset mail; a Google user with an unverified Google email needs it), edge **per-IP rate limiting** on `/api/v1/auth/*` including `oauth/google/start` and `…/callback`, and query-string stripping on `/api/v1/auth/oauth/*` in **every proxy / CDN access log** (the callback URL carries the one-time `code` and `state`; the API's own request log already omits query strings and uvicorn's access log is disabled by the application).

### 10.3 When it fails: which stage

The browser only ever gets a fixed code. For `oauth_failed`, the API log has one `app.oauth` warning naming the stage. It never contains a code, state, token, secret, email or provider free text.

| `stage` | Other fields | Usual cause |
|---|---|---|
| (no log; start answers `503`) | | `GOOGLE_OAUTH_PROVIDER` is not `google`, or the API was not restarted / was not started from `backend/` |
| (no log; Google's own error page) | | `redirect_uri_mismatch` (the URI in the console differs by any character), wrong client id, or the account is not a *Test user* |
| `flow` | `reason: missing_flow_cookie` | the sign-in started on a different host than the callback (`localhost` vs `127.0.0.1`), or the browser blocked the cookie |
| `flow` | `reason: no_matching_flow` | more than 10 minutes elapsed, the callback was replayed or reloaded, or a second sign-in was started in the same browser |
| `token_exchange` | `providerStatus: 401`, `providerError: invalid_client` | wrong client secret, or id and secret from different clients |
| `token_exchange` | `providerError: invalid_grant` / `redirect_uri_mismatch` | the code was already used or expired, or `API_PUBLIC_BASE_URL` does not match the registered URI |
| `token_exchange`, `jwks` | `errorType: ConnectTimeout` / `ConnectError` / `ReadTimeout` | this machine cannot reach `oauth2.googleapis.com` / `www.googleapis.com` (network, firewall, antivirus TLS inspection). The code is single-use, so there is no automatic retry: start again |
| `id_token` | `errorType: ImmatureSignatureError` / `ExpiredSignatureError` | the machine's clock is more than 30 s wrong |
| `id_token` | `errorType: InvalidAudienceError` | the token was issued for another client id |
| `nonce`, `claims` | | the token does not belong to this flow, or lacks a usable `sub` / `email` / boolean `email_verified` |

`identity_conflict`, `email_not_verified`, `account_disabled` and `oauth_denied` are policy outcomes (`AUTH_RBAC.md` §10.4), not faults.

### 10.4 Real-Google smoke checklist (manual; not part of CI)

With a *Testing*-mode consent screen and your Google account as a test user, after §10.1:

1. At `http://127.0.0.1:5173/login`, **Continue with Google** with an account whose email has no B-17 account → you return signed in. Open `/profile`, reload → still signed in. The account has no role, staff scope or professional profile.
2. **Log Out**, then Google sign-in again with the same account → same account (`SELECT count(*) FROM auth_identities` is unchanged).
3. At Google's consent screen press **Cancel** → `/login` says Google sign-in was cancelled.
4. After a successful sign-in, log out and re-open the callback URL from browser history → "We couldn't complete Google sign-in" and no session.
5. With a second Google account whose email already has a **verified** password account → "An account with this email already exists"; nothing is linked. (An *unverified* password account with that email is instead reclaimed by the proven mailbox owner: password cleared, old sessions revoked — `AUTH_RBAC.md` §10.4 C2.)
6. Email/password login still works for an existing account.

*Connect Google* and *Disconnect* have API endpoints but **no screen yet** (`AUTH_RBAC.md` §23). No test in the repository performs these steps against real Google.

**Status (reported by the project owner, 2026-11-26): local real Google sign-in works** - a successful sign-in, the session persisting after reload, logout and a repeat sign-in (the sign-in, reload and logout parts of steps 1 and 2). The remaining checks above were not reported. Production is not configured or tested.

## 11. Maps and location operations (Phase 12A requirements; design in `LOCATION_MAP.md`)

Nothing here is implemented in 12A; it records what deployment must provide when slices 12B and 12G land.

| Setting | Where | Meaning |
|---|---|---|
| `LOCALITIES` *(implemented in slice 12D)* | API environment (default `B-17`; comma-separated or a JSON list; matched trimmed and case-insensitively; an empty value fails startup) | The canonical locality list that a new listing's `area` must belong to (`LOCATION_MAP.md` §4). Mirrored by the frontend config until a managed lookup exists. **There is no geofence setting**: only latitude `-90..90` / longitude `-180..180` are validated; B-17 geofencing waits for authoritative geographic data (`LOCATION_MAP.md` §5). |
| `VITE_MAP_TILE_URL` · `VITE_MAP_TILE_ATTRIBUTION` | frontend build | The raster tile template and its required attribution. Dev / demo default: standard OpenStreetMap tiles. **Production must set a compliant provider.** |
| `VITE_MAP_DEFAULT_CENTER` | frontend build | Picker start position (`lat,lng`; falls back to a labelled Islamabad city centre). It is a starting view, not a limit. |

- **Tile provider.** The public OpenStreetMap tile servers are for light development and demo use under the OSM Tile Usage Policy (attribution, identification through a valid `Referer`, no bulk or offline downloading); they are not a production CDN and may block heavy traffic. For production choose, at deployment time, either a commercial tile service (check its terms, attribution and quota) or self-hosted tiles. No provider is chosen or priced here; swapping is a build-time configuration change. Tile requests are cross-origin, so the service worker never caches them (keep it that way).
- **No API key for Get Directions.** The directions link is a plain `https://www.google.com/maps/dir/?api=1&destination=…` URL; it needs no Google Cloud project and is unrelated to the Google OAuth client of §10.
- **Referrer policy.** Keep `Referrer-Policy: no-referrer` on `/verify-email` and `/reset-password`; set a standard policy (`strict-origin-when-cross-origin`) for the rest of the site so tile servers that require a referrer work. Configure this per route in the host / reverse proxy.
- **CSP.** None exists today. If one is introduced, `img-src` must include only the configured tile host (plus `self` and `data:` for inline icons) and `connect-src` the API origin.
- **Upgrading an existing database to `0005`.** `alembic upgrade head` (DDL only, no data change; it rewrites `listings` once to compute the generated columns — run it in the normal migration window) → for dev / staging `python -m scripts.dev_fixtures` (idempotent; applies the explicit demo-location step to fixture ids only; refuses production; it prints how many fixtures were relocated; *RBAC freeze, 2026-11-19: the staging part of this step is to be dropped once the loader also refuses staging — planned, `AUTH_RBAC.md` §27.14; today it refuses only production*) → `python -m app.db.search_index check` (no rebuild needed for existing rows). Existing listings become area-level legacy rows; nothing is inferred (`LOCATION_MAP.md` §3.1).
- **Upgrading an existing database to `0008` (RBAC-D).** `alembic upgrade head` — a data step plus one constraint, run in the normal migration window. It makes every existing Service / Professional listing portal-managed: `UPDATE listings SET owner_id = NULL WHERE kind = 'provider'`, then `ck_listings_provider_has_no_owner` (`AUTH_RBAC.md` §31). Nothing else changes (no revision, status, timestamp, search document or history row; no staff audit is invented). Before upgrading, `SELECT count(*) FROM listings WHERE kind = 'provider' AND owner_id IS NOT NULL` says how many providers are affected; their former author stays visible as the actor of each one's first history row. After it, a provider can only be created and managed through `/admin/providers` by a Super Admin or a `services` Moderator, and a service request to a provider is handled by staff through `/admin/requests` (a Super Admin or a `services` Moderator; `AUTH_RBAC.md` §31). **`alembic downgrade 0007` REFUSES while any live (non-archived) Provider exists** and says how many: rolling the schema back would leave ownerless Providers that the RBAC-C release cannot edit or archive. To roll back, redeploy the previous *application* release WITHOUT downgrading (it runs against a `0008` database), or archive the Providers on purpose first; only then does the downgrade drop the constraint. Re-upgrading is idempotent. A development database that holds the old fixtures needs nothing else: the upgrade handles them.
- **Privacy in logs.** The request log records no bodies or query strings, so coordinates never reach it; do not add proxy-level body logging for `/api/v1/listings`.

## 12. Frontend authentication operations (Phase 12C)

| Setting | Where | Meaning |
|---|---|---|
| `VITE_API_BASE_URL` | frontend build | API base including `/api/v1`. Default: the relative `/api/v1` everywhere — in `vite dev` and `vite preview` Vite proxies `/api` to the local API (`B17_API_PROXY_TARGET`, default `http://127.0.0.1:8000`), in production the reverse proxy does (Phase 12S). If the API is on another origin (`https://api.…`), set it **and** put the frontend origin in the API's `FRONTEND_ORIGINS` and `FRONTEND_BASE_URL`; cookies need the same-site topology of §9. |

- **No secret is ever a `VITE_*` variable.** The frontend holds no key, client secret or token; the Google client secret stays on the API.
- **Referrer policy.** `/verify-email` and `/reset-password` carry the one-time token in the URL fragment (never sent to servers) and the SPA sets `<meta name="referrer" content="no-referrer">` for them and removes the fragment before anything else runs. Also set `Referrer-Policy: no-referrer` for those two paths at the host/CDN (an HTTP header is stronger than the meta tag); keep a standard policy elsewhere (§11).
- **SPA fallback for auth links.** `/verify-email`, `/reset-password`, `/forgot-password` and `/login` must serve `index.html` (the same SPA fallback as every route); the OAuth callback redirects the browser to `/login?error=…` or the requested `returnTo`.
- **Caching.** Do not cache `/api/*` at the CDN for authenticated paths; the service worker already leaves `/api` untouched (network-only).
- **Logs/analytics.** Do not add third-party scripts to the token routes; do not log full URLs of `/login?error=` or the token routes in analytics.

## 13. Transactional email (EMAIL-1)

Architecture, messages, failure behaviour and guarantees: `AUTH_RBAC.md` §14. **Status: real delivery was accepted by the project owner locally through the Resend sandbox (reported 2026-11-26; §13.5). No verified domain and no production delivery.** Nothing here is needed for development or CI.

### 13.1 Provider: Resend (why)

| | Resend | Postmark | Amazon SES |
|---|---|---|---|
| Free allowance (checked 2026-11-26) | 3,000 / month, **100 / day**; 3 domains; 30-day data retention | 100 / month | not checked |
| First paid step | $20 / month for 50,000, no daily cap | about $15 / month for 10,000 | per-message pricing, lowest at volume |
| Integration here | one HTTPS `POST` over the existing `httpx`; documented `Idempotency-Key` | HTTP API | AWS account, request signing or the AWS SDK (a new dependency) |

Resend was chosen because it needs no new dependency, its idempotency key makes the single retry safe, and its setup is the smallest. SES is the one to revisit if volume (Grocery, service-request notifications) makes price matter. The choice is confined to `email_resend.py`. Prices and limits change: confirm them on the providers' pricing pages before buying.

**Plan size matters.** Every password and Google sign-in by a verified user sends a notice. The free plan's 100 / day would be reached quickly with real users, and an exhausted quota **also stops verification and password-reset mail**. Use a paid plan before launch.

### 13.2 Variables (server-side only; the key from the host's secret store, never `VITE_*`, never git)

| Variable | Local default | Local Resend sandbox (§13.4) | Production |
|---|---|---|---|
| `EMAIL_BACKEND` | `console` | `resend` | `resend` (default there: `disabled`) |
| `RESEND_API_KEY` | unset | your sending-only key | a separate sending-only key, restricted to `mail.b17portal.com` |
| `EMAIL_FROM` | `B-17 Portal <no-reply@localhost>` | `B-17 Portal <onboarding@resend.dev>` | `B-17 Portal <notifications@mail.b17portal.com>` |
| `EMAIL_SUPPORT_ADDRESS` | unset | unset | **unset until a monitored mailbox exists** (it becomes `Reply-To` and is named in the footer) |
| `EMAIL_TIMEOUT_SECONDS` | `10` | `10` | `10` |
| `FRONTEND_BASE_URL` | `http://127.0.0.1:5173` | `http://127.0.0.1:5173` | `https://b17portal.com` (every e-mail link uses it) |

The key is one word of printable characters; spaces and newlines around a paste are dropped. An incomplete `resend` configuration stops the API at startup, `ENVIRONMENT=test` refuses `resend` altogether, and startup errors quote no input. **There is no frontend setting:** the API reports `emailDelivery` (`email` / `console` / `off`) and the screens follow it.

### 13.3 The sending domain: `mail.b17portal.com` (owner action; nothing here was done)

1. Resend account: two-factor sign-in, and limit who has access - the dashboard shows sent messages, **including live verification and reset links**, until they expire.
2. Add the domain **`mail.b17portal.com`** (a subdomain keeps sending reputation apart from the main domain). The sender is **`notifications@mail.b17portal.com`**; sending does not require a mailbox at that address.
3. At the DNS provider of `b17portal.com`, add **exactly** the records the domain's *Records* tab shows (names and values; record types vary, so do not copy them from a guide). Check whether your DNS provider appends the domain to the host name by itself.
4. Add **DMARC** as a TXT record, monitoring only at first: host `_dmarc.mail.b17portal.com`, value `v=DMARC1; p=none; rua=mailto:<an address someone reads>`. Move to `quarantine`, then `reject`, once reports show that every legitimate sender passes. (A policy on `_dmarc.b17portal.com` would also cover subdomains; decide with whoever manages the main domain's mail.)
5. Wait for *Verified*.
6. **Keep open and click tracking OFF** (Resend's default), and do not add a tracking subdomain. Click tracking rewrites links through that domain, which would carry the one-time tokens there.
7. Create a **new** API key with the sending-only permission (`sending_access`), restricted to this domain. Use it in the deployed environment only; revoke any key that is no longer used.

### 13.4 Local setup with the Resend sandbox

**What the sandbox can do:** from `onboarding@resend.dev`, Resend delivers **only to the e-mail address of your own Resend account** (anything else is refused with `403`). Resend's `delivered@resend.dev` and `bounced@resend.dev` are test recipients that simulate outcomes.

1. In Resend, **API Keys → create a key** with the **sending-only** permission (API name `sending_access`, not full access). Without a verified domain there is nothing to restrict it to. Resend does not show the value again: copy it straight into the file below and nowhere else (not chat, not git, not a screenshot).
2. In `backend/.env` (git-ignored) add or uncomment exactly:

```
EMAIL_BACKEND=resend
RESEND_API_KEY=<paste your sending-only key>
EMAIL_FROM=B-17 Portal <onboarding@resend.dev>
```

Leave `EMAIL_SUPPORT_ADDRESS` unset. `ENVIRONMENT` stays `development`; `FRONTEND_BASE_URL` already defaults to `http://127.0.0.1:5173`.

3. **Use an empty database for the first run** if your Resend address already has a B-17 account locally (for example from the Google sign-in test): registration would answer "already registered", and the verification steps need a new account. This leaves `b17_dev` untouched. In PowerShell, from the repository root:

```powershell
docker exec b17-portal-db-1 psql -U b17 -d postgres -c "CREATE DATABASE b17_mail;"
cd backend
$env:DATABASE_URL = "postgresql+psycopg://b17:b17_dev_password@127.0.0.1:54329/b17_mail"
.\.venv\Scripts\alembic.exe upgrade head
```

4. **Restart the API** from `backend/`, in that same window if you set `DATABASE_URL` (stop any API already on port 8000 first): `.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000`.
5. Start the app (`npm run dev`) and open `http://127.0.0.1:5173`. The links in the mail point at this local app, so **open them on the same computer**.

To go back: set `EMAIL_BACKEND=console` (or comment the three lines), restart the API, and close that PowerShell window (or `Remove-Item Env:DATABASE_URL`). With no credentials at all, `console` prints each message in the API terminal and `python -m app.cli.dev_verify <email>` prints a verification link. **Automated tests never read these settings and cannot reach a provider** (`TESTING.md`).

### 13.5 Manual acceptance checklist

**Reported by the project owner, 2026-11-26 (local app, sandbox sender, own address):** registration verification e-mail; verifying the address on the laptop; the e-mail / password sign-in notice; the forgot-password e-mail; the password reset; the password-changed notice; the Google sign-in notice. The logs also showed the provider refusing an unauthorized sandbox recipient while the registration succeeded. In the table: step 1 (the verification mail and verifying; the on-screen wording was not separately reported), the sign-in mail of step 4, the mails and the reset of steps 6-7 (not the used-link refusal), and the Google notice of step 9. **Steps 2, 3, 5, 8, 10, 11 and 12 were not reported**; the unauthorized-recipient refusal is a different failure from step 12's wrong key. A tracking redirect seen in the Google notice is open (§13.7).

Use your Resend account's address as the B-17 account. Check the spam folder too. `email accepted by provider` in the API log means accepted for sending; **only the inbox shows delivery.**

| # | Do | Pass when |
|---|---|---|
| 1 | Register | the toast and the banner say to check your inbox and spam folder; no development text; **one** verification mail arrives from `onboarding@resend.dev` |
| 2 | After a minute, **Profile → Resend verification email**, before opening any link | the screen says a new link was *requested*; a second mail arrives |
| 3 | Open the **first** link, then the **newest** | the first is refused (invalid or used); the newest verifies the account |
| 4 | Log out, log in with the password | **one** "New sign-in" mail: your address, the correct Pakistan time, *Email and password* |
| 5 | Reload several pages while signed in | **no** further mail |
| 6 | Log out, **Forgot password** with your address | the answer starts "If an account exists..." and says where to look; the reset mail arrives |
| 7 | Reset the password; open the same link again | a *password changed* mail arrives; the used link is refused |
| 8 | Forgot password with an address that has no account | the **same** on-screen answer as step 6; no mail |
| 9 | Google sign-in notice: needs an account **created by Google** (a password account with the same address is refused by design, `identity_conflict`, and sends nothing). With the sandbox, the Google account **must use your Resend address** (the only recipient it reaches). Use another empty database (§13.4 step 3, a new name such as `b17_mail2`), *Continue with Google* once (creates the account: **no** mail), log out, *Continue with Google* again | **one** "New sign-in" mail saying *Google* |
| 10 | In a received mail: view the original / headers and the link addresses | SPF and DKIM pass; links are plain `http://127.0.0.1:5173/...#token=` addresses, **not** rewritten through a tracking domain |
| 11 | Read the API terminal output of the whole run | no token, link, API key or e-mail address on any log line |
| 12 | Put a wrong key in `RESEND_API_KEY`, restart, log in | the login works; the log says `email refused` with a `providerStatus`, and shows no address or link. Restore the key |

Limits that can interrupt the run: resend verification 1 per minute and 5 per day; forgot-password 3 per hour; 10 sign-in notices per hour; Resend's own free daily quota. There is no change-password screen, so that notice is covered by step 7 and the automated tests. After the domain is verified, repeat steps 1-8 from `notifications@mail.b17portal.com` to an address at a **different** provider, and confirm that SPF, DKIM **and DMARC** pass and that every link is `https://b17portal.com/...`.

### 13.6 Mandatory before launch

1. **Durable delivery.** The queue is process memory (`AUTH_RBAC.md` §14.2); it is accepted for development only.
2. **Protection of verification and password-reset mail from notification saturation.** Today every kind shares **one** first-in, first-out queue of 100 with 2 workers, and **one** provider quota. A full queue drops the newest message **whatever its kind**. The cap of 10 notices per hour limits one account, not many accounts together. During a provider outage a message can hold a worker for about 20 seconds (two 10-second attempts), so only a few leave per minute and the queue fills. A design must reserve capacity or give account-recovery mail its own priority lane, **and** protect the sending quota.
3. **Monitoring and alerting:** refused / unconfirmed / dropped sends (`app.email`), bounces and complaints (dashboard today; webhooks later), and quota use.
4. A paid plan sized to the expected sign-ins; the verified `mail.b17portal.com`; DMARC; no support address until the mailbox is monitored.
5. Per-IP rate limiting on `/api/v1/auth/*` at the proxy / CDN (it also protects the mail quota).
6. **The tracking redirect (§13.7) identified and proven absent** from production mail, with open and click tracking off on the production sending domain.
7. **MFA for every Super Admin and Moderator**, with no production bypass (`AUTH_RBAC.md` §27.13). It is not specific to e-mail; it is listed so that no launch list omits it.

The **production OAuth prerequisites in §10 are unchanged**: production OAuth configuration, per-IP rate limiting including the OAuth start and callback, and removing the callback query string from every proxy / CDN access log.

### 13.7 OPEN - a tracking redirect in the received Google sign-in notice

**Reported by the project owner (2026-11-26).** Neither the redirect address nor the message source has been examined yet, so **the cause is not established.**

**What the application sends (checked from the template and the adapter).** The Google notice has one link, in two places (button and text): the direct `{FRONTEND_BASE_URL}/forgot-password` address, which carries no token. Google's security address `https://myaccount.google.com/security` is **plain text**, which a mail app may turn into a link of its own. The adapter's request has no tracking field (`from`, `to`, `subject`, `text`, `html`, `reply_to`, `tags`), and the HTML loads nothing remote. So a redirect was introduced **after** the message left the API.

**Candidates.** (a) **The provider rewriting links before delivery** (click tracking). Resend documents tracking as off by default and active only with a verified tracking subdomain; that documentation does not say how the shared `resend.dev` sandbox sender is configured. (b) **The mail app or a security product wrapping a link** when it is shown or clicked: Gmail and Google Workspace can send a click through a `google.com/url?...` address without changing the delivered message. Neither is confirmed.

**How to decide it.** Open the received message's **original source** (Gmail: ⋮ → *Show original*; download it and read the decoded HTML part, since the encoded source wraps long lines) and look at each `href`. Also open the same message in the Resend dashboard and read its events and HTML.

| Delivered source shows | Meaning |
|---|---|
| `href` values exactly the application's addresses | the message was not rewritten: the redirect is added by the mail app or a security product at view / click time |
| `href` values pointing at any other host | links were **rewritten before delivery**: a launch blocker; tracking is on somewhere and must be off |

Report only the **host name** of the redirect. **Do not paste a full redirect address or the message source** anywhere: a rewritten verification or reset address can contain a live one-time token and identifies the recipient.

**Production requirement.** Open and click tracking stay **off** on `mail.b17portal.com`, with no tracking subdomain configured. Before launch, send all four message types from the verified domain and show in the delivered source that every link is the exact `https://b17portal.com/...` address - the verification and reset links with their `#token=` fragment intact - to at least a Gmail and a non-Gmail mailbox. Repeat after any change to the provider's domain settings. A rewrite would hand one-time tokens to a tracking service and its logs.

## 14. Staff scope migration `0010` (GROCERY-1a): upgrade and rollback

### 14.1 Upgrade

1. Apply the migration (`alembic upgrade head`) **before or together with** the new application. It replaces one `CHECK` and changes no row.
2. Deploy the application.

The previous application works against the `0010` schema as long as nobody holds `grocery` (it cannot assign it). The new application on a `0009` schema works except that assigning `grocery` fails (`500 internal_error`) and changes nothing; do not leave it that way.

### 14.2 Rollback — the order is mandatory

> **Application code older than `0010` cannot read a `grocery` assignment.** The column maps to a closed enum, so loading such a row raises. With one in the database, the old application fails **every signed-in request of that Moderator**, and also fails the **Super Admin staff roster and any staff action on that Moderator** — so the old application **cannot be used to remove it**.

**Checked on 2026-11-26** by running the previous release's code (`004a208`) against a throwaway database at `0010` with `grocery` assignments. For a holder: an existing session, a fresh sign-in and the listing queue each answered `500`. For the Super Admin: `/auth/me` and the staff audit still answered `200`, while the roster, **pause** and **remove** answered `500`. Another Moderator, a Resident and the public routes were unaffected. Following the order below, the downgrade was refused while assignments existed and succeeded after their removal, the audit rows were unchanged, and the previous code then worked for every former holder.

1. **With the new application still running**, find every holder (staff roster: `GET /api/v1/admin/staff`, all pages). Remove `grocery` through staff management, which audits each change and revokes that person's sessions:
   - a Moderator who holds only `grocery`: **pause** (keeps the role with no scope) or **remove**;
   - a Moderator who also holds listing scopes: **replace the scopes** without `grocery`.
   These are Super Admin actions that need a recent sign-in (15 minutes). Make no new `grocery` assignment until the rollback is finished.
2. **Confirm that none is left**: `SELECT count(*) FROM staff_scope_assignments WHERE scope = 'grocery';` returns `0`.
3. **Downgrade the database** (`alembic downgrade 0009`). It refuses, changing nothing, while an assignment exists.
4. **Roll back the application code.**

**Rolling back the code without step 1 is the dangerous case, and no migration can prevent it.** If it has happened, redeploy the new application and follow the order above. Do not delete rows by hand: that removes staff authority without an audit record or a session revocation.

**Audit history is preserved.** `staff_audit_events` is append-only. Entries that mention `grocery` are not rewritten or deleted by the downgrade and do not block it; they are plain JSON that older code reads as it is.

### 14.3 Applying `0010` to a local development database

Windows PowerShell, from `backend/`, with the API stopped. **Rehearsed on 2026-11-27 on throwaway databases** (backup, upgrade, drift check, downgrade, and a restore of the backup into a second database); the development database itself was not touched. Stop at any step whose result differs.

1. No shell override: `Test-Path Env:DATABASE_URL` prints `False` (otherwise `Remove-Item Env:DATABASE_URL`).
2. The target, **by name only** (prints no credential); it must print the database you mean, normally `b17_dev`:

   ```powershell
   .\.venv\Scripts\python.exe -c "from sqlalchemy.engine import make_url; from app.core.config import Settings; print(make_url(Settings().database_url.get_secret_value()).database)"
   ```

3. `.\.venv\Scripts\python.exe -m alembic current` prints `0009`.
4. Back up **outside any synced folder**: the dump holds personal data and password hashes. Do not redirect `pg_dump` with `>` (Windows PowerShell corrupts binary output); write inside the container and copy the file out.

   ```powershell
   New-Item -ItemType Directory -Force "$env:USERPROFILE\b17-backups"
   docker exec b17-portal-db-1 pg_dump -U b17 -d b17_dev -Fc -f /tmp/b17_dev_before_0010.dump
   docker exec b17-portal-db-1 pg_restore --list /tmp/b17_dev_before_0010.dump | Select-String "TABLE DATA public users "
   docker cp b17-portal-db-1:/tmp/b17_dev_before_0010.dump "$env:USERPROFILE\b17-backups\b17_dev_before_0010.dump"
   docker exec b17-portal-db-1 rm /tmp/b17_dev_before_0010.dump
   ```

   The third command must print one line, and `docker cp` must succeed, before you continue.
5. `.\.venv\Scripts\python.exe -m alembic upgrade 0010`
6. Verify: `alembic current` prints `0010 (head)`; `alembic check` prints `No new upgrade operations detected.`; and nobody holds the new scope (`0`):

   ```powershell
   docker exec b17-portal-db-1 psql -U b17 -d b17_dev -tAc "SELECT count(*) FROM staff_scope_assignments WHERE scope = 'grocery'"
   ```

7. Start the API again.

**To go back:** while nobody holds `grocery`, `alembic downgrade 0009`, then run the older code. If anyone does, follow §14.2 first. Restoring the dump is a last resort: it discards everything written since the backup. Delete the dump when you no longer need it.

## 15. Grocery order intake, migration `0011` (GROCERY-1b)

> **GROCERY-2 (2026-11-27):** a staff queue and order handling now exist in the **backend** (§17). **Update (GROCERY-3A / 3B):** customer and staff order screens have since been built (`docs/product/GROCERY.md`), tested against fakes only. **GROCERY-3C** added screens for Grocery settings and staff management, also tested against fakes only. Nothing about a deployment changes with them, and **staff MFA still does not exist**. Where this section says there is no staff queue, read it with this note. The `TRUNCATE` limitation below **also applies** to `grocery_order_confirmations`, `grocery_payments` and `grocery_order_events`. Grocery stays disabled for real customers.

**Upgrade:** `alembic upgrade head` before or with the application. It only creates five tables and inserts the default settings row. The new application **requires** `0011` for every `/grocery` route; the rest of the portal does not read those tables.

**Applying it to a local database:** follow §14.3 (check the target by name, back up outside any synced folder, verify), upgrading to `head`. `alembic current` must then print `0011 (head)`. A database still at `0009` receives `0010` and `0011` in the same run.

**Rolling back**

- **The application alone can be rolled back safely** to the release before GROCERY-1b: it does not read the new tables. (The rule of §14.2 still applies to anything older than `0010`.) Orders stay stored and are served again after rolling forward.
- **Downgrading `0011` refuses, changing nothing,** while any order or capacity record exists, or the settings were ever changed. A database where Grocery was never used downgrades cleanly. Removing real data first is a deliberate, destructive operator decision: take a backup, and expect the append-only triggers to block deletes.

**Grocery is disabled after deployment and stays so until a Super Admin enables it.** Enabling it today only lets customers submit orders **that no staff member can see or process through the portal** (there is no staff queue), and sends no e-mail. **Do not enable it for real customers** before the pilot blockers are closed, at least: the owner-verified block list configured; the staff review, quotation and fulfilment phases; privacy and retention, refund and cash-handling policies; durable, prioritised e-mail with quota protection and the tracking investigation, if any Grocery e-mail is sent; production Google OAuth; per-IP rate limiting at the proxy and callback-log sanitization; a control against several accounts filling a day's capacity, which per-account limits cannot stop (**GROCERY-5 requirement**); MFA for every staff account; backups with a tested restore; monitoring.

**Blocker register additions (owner, 2026-11-27):**

- **Order history can be emptied by `TRUNCATE`.** `grocery_order_status_history` refuses only `UPDATE` and `DELETE` by trigger. This limitation stays open until production controls it.
- **Required before production: least-privilege application database credentials.** The runtime role of the two-role design above must be used: data reads and writes only, **no `TRUNCATE`, no schema changes, and not the owner of any table** (an owner can disable a trigger). Migrations run under the separate migration role. Verify the grants on the deployed database.
- **Corrected in GROCERY-4B (§21): the daily submission-limit reset.** The 4-per-day limit used to reset at **05:00 PKT** (midnight UTC), while capacity uses the Karachi date; it now counts Karachi calendar days.

**Authentication concurrency (2026-11-27):** the token / user deadlocks, the password-reset bypasses (`AUTH_RBAC.md` §35) and staff changes surviving a revoked session (§36) are corrected. What remains is in §16.

There is **no deployment-level switch**: the database setting is the only one (planning had suggested an additional `GROCERY_ENABLED` setting; it was not approved).

## 16. Production security backlog

Recorded 2026-11-27 by the owner's decision. **Deferred: none of these is implemented.** Each needs a decision before public production. It adds to, and does not replace, the pilot and launch blockers of §15 and the earlier sections.

| # | Item | What is known |
|---|---|---|
| 1 | **Expired-data cleanup deadlock** (potential) | `app.cli.auth_maintenance purge` deletes sessions and tokens without locking users. By reading only, not reproduced: a password reset for a user who still has both week-old expired sessions and week-old unused tokens could deadlock with it. |
| 2 | **A delayed logout-all reaches newer sessions** | A `logout-all` authenticated before a password reset, and applied after it, also revokes sessions created since. It grants no access. |
| 3 | **Failed sign-in limit under concurrency** | The limit is checked before an attempt and counted after it, so simultaneous attempts can slightly exceed it. Per-IP limiting at the proxy is still required. |
| 4 | **Least-privilege database credentials** | Required before production (§15): no `TRUNCATE`, no schema changes, not the owner of any table. |
| 5 | **Comprehensive review of privileged operations** | `AUTH_RBAC.md` §36 covers revocation, expiry, account status and role for the staff mutations that exist today. Open for the review: a password change **in the same session** rotates its token without revoking it, so a request already past authentication with the old token is still applied; freshness windows are judged only as the request arrives; staff **reads** use the request-start authority; owners' and customers' own writes do not re-check their session (Grocery orders do); **MFA for every Super Admin and Moderator is required before production** (`AUTH_RBAC.md` §27.13) and does not exist; and every **new** privileged route must follow the mandatory rule of `AUTH_RBAC.md` §36.4 (nothing yet fails automatically if one does not). |

## 17. Grocery order handling, migration `0012` (GROCERY-2)

**`0012` has been run only on isolated test databases.** It has not been applied to a local or hosted application database.

**Upgrade:** `alembic upgrade head` **before** the application (§14.3 for a local database: check the target by name, back up outside any synced folder, verify). It is additive: new columns, wider checks, three new tables, no data statement. Existing orders and settings are kept; the new cap column takes its default. It takes short exclusive locks on the three altered Grocery tables. The new application **requires** `0012` for every `/grocery` and `/admin/grocery` route. `alembic current` must then print `0012 (head)`.

**Rolling back**

- **Before any staff action** the application can be rolled back to the GROCERY-1b release, with the database left at `0012`: the older code reads only `submitted` and `cancelled` orders and customer history rows, and the new settings column has a default.
- **After any staff action, rolling back the application is NOT safe.** Older code cannot read the new statuses or `actor_role = 'staff'`: customer order lists and details that include such an order would fail, and it would count that order wrongly against the active limit. **Roll forward.** Disabling Grocery stops new orders but does not make an older release able to read handled ones.
- A changed value cap alone does not break the older release, which ignores the column (a settings change made by the older release takes the default cap again).
- **Downgrading `0012` refuses, changing nothing,** while any staff-handled, assigned or priced order, agreement, cash collection, event, staff history row or changed cap exists. Removing real records is a deliberate, destructive operator decision: take a backup, and expect the append-only triggers to block deletes. These are financial records.

**Still disabled.** The deployment enables nothing: `enabled` stays `false` and the block list stays empty until a Super Admin changes them. No Grocery scope is granted by any migration.

**Before real customers, in addition to every blocker in §15 and §16:**

- the customer and staff order screens (**built**, GROCERY-3A / 3B) **verified against the real backend** (**partly done**: one customer-to-cash journey, own-order privacy and removal of a Moderator's access, `e2e-real/18-grocery.spec.ts`, GROCERY-4A; failed delivery, cancellation, issues, release and reduced amounts are **not** done), together with the **Grocery settings and staff-management** screens (built, GROCERY-3C; not yet run against a real backend) and an operating procedure for releasing the orders of a paused or removed grocery Moderator;
- the **PKR 20,000** pilot cap including fees is approved (owner, 2026-11-27) and configurable; confirm the stored setting before enabling;
- the owner-verified serviceable block list;
- **pilot launch requirements, still unresolved:** written **refund / dispute**, **privacy / retention**, **excluded-goods** and **cash-handling** (custody, daily reconciliation, who may collect) policies;
- written working rules for failed deliveries and for the cost of goods already bought when an order is cancelled (only a Super Admin may cancel then);
- a staff routine for the approved policy that **the team tells customers directly** about cancellations, substitutions and failed deliveries (the application sends nothing); a recorded agreement stays a **staff attestation** and is never presented as authenticated customer consent (`AUTH_RBAC.md` §37.5);
- staff **MFA**; tested backups; monitoring of orders waiting without a holder.

**The portal is not production-ready.**

## 18. Service worker: offline cache and `Vary` (fix, 2026-11-27; frontend only)

**Defect (existed before GROCERY-3A: reproduced on a build of `e70c651`).** Going offline right after a **first** visit and reloading showed a **blank page**, although the app's entry files had been precached. The worker's precache requests carry **no `Origin` header**; the page requests its `crossorigin` module scripts and stylesheet **with** one; `vite preview` answers those files with **`Vary: Origin`**. The cache lookup therefore missed every precached file. Proven by changing only the lookup in a built worker: the page then rendered. The older browser tests reloaded once online first, which re-cached the files through the worker and hid it.

**Fix** (`pwa/sw.template.js`): the lookup for **`/assets/*` only** uses `ignoreVary: true`. Those URLs are content-hashed, same-origin and immutable, so one URL is one file whatever header asked for it. The navigation fallback is unchanged, and **`/api` stays network-only: never cached or looked up.** Pinned by `e2e/pwa/first-visit.spec.ts` (offline with no online reload; every precached file served) and `src/pwa/serviceWorkerPrecache.test.ts`; both fail without the fix.

**Hosting:** whether the production host sends `Vary: Origin` is not known (no host is chosen); the fix does not depend on it. If a host varies built assets on a header that changes their **content** (not expected for hashed files), this assumption must be revisited.

**Still not available offline after a first visit, by design:** screens not yet opened (their code is not precached), images, and font subsets the page had not yet loaded (it falls back to system fonts). Real-device behaviour has not been tested.

## 19. Sessions, tabs and staff changes, migration `0013` (GROCERY-4A)

**`0013` has been run only on isolated test databases.** It has not been applied to a local or hosted application database. No configuration or environment variable changes.

**Deploy in this order:**

1. `alembic upgrade head` (§14.3 for a local database: check the target by name, back up outside any synced folder, verify). Additive: one column, `users.staff_revision` with default 0 and a non-negative check; no data statement. Adding it takes a brief exclusive lock on `users`. `alembic current` must then print `0013 (head)`.
2. The **backend**. It **requires** `0013`: without the column every request that loads a user fails. **The same holds for a local development database:** running this code against one behind `0013` breaks sign-in and every signed-in request until it is migrated (§14.3). From here, private-read binding, the two staff clocks and the cookie rule are in force.
3. The **frontend**, promptly. Between 2 and 3 the older frontend keeps working **except staff management**: every appointment and change it sends is refused (`422`) and changes nothing.

**Frontend first is safe but limited:** against the older backend the new frontend still confirms every private answer and keeps staff tabs quiet (no `readBinding`), and sends no staff change to an existing member.

**Old clients.** A browser or installed PWA still running a cached older build sends no session name on reads, so it is **not** protected by the binding (its staff writes are refused). It updates when the new service worker takes over. Making the header mandatory is a later decision.

**Rolling back**

- The **application** can be rolled back with the database left at `0013`; older code ignores the column. The older backend also brings back the corrected defects (cookie re-issue, `/auth/me` keeping staff fresh, unversioned staff changes).
- The older code does **not advance** the revision. A staff page left open across a roll-back and roll-forward may hold a revision that no longer reflects what happened between: **reload staff pages** after any roll-back.
- **Downgrading `0013`** drops the counts (no other data). Only with the older backend, and never as routine: after upgrading again every account starts at 0, so staff pages opened before must be reloaded.

**Cookies.** Sessions that exist at deployment keep their cookie's earlier, shorter `Max-Age` (up to 14 days from when it was last set), and it is no longer renewed: such a browser is signed out when that runs out even if it was in use, and signs in again once. New sign-ins get the absolute lifetime.

**Operational:**

- **More `/auth/me` traffic:** every successful private read is followed by an `/auth/me` that confirms whose answer it was (reads finishing together share one). Account for it in capacity and in any rate limit placed in front of the API: a limit on `/auth/me` would make private screens fail.
- Tabs of one origin use `BroadcastChannel`; nothing is added to web storage, and the service worker still handles no `/api/` request.
- **Still open** (`AUTH_RBAC.md` §38.2, §38.5): clients that send no session name are unprotected; a late `401` or sign-out can clear a newer session cookie (a sign-out, never access). These join the blockers of §15–§17, which this phase does not close. **The portal is not production-ready.**

## 20. Mandatory pre-pilot security review (recorded by the owner, 2026-11-28)

GROCERY-4A was accepted as a **development checkpoint only**. **Every item below must be reviewed, with a recorded decision (fix, or accept with a reason), before any pilot, and so before any public launch.** None is cleared. This adds to, and replaces nothing in, §15, §16 and §17 (**staff MFA** among them).

| # | Item | What is known | Detail |
|---|---|---|---|
| 1 | **A late `401` or logout clears a newer session cookie** | Signs the newer sign-in out; grants nothing. Closing it needs a different session architecture: only outlined, not designed or approved | `AUTH_RBAC.md` §38.5 |
| 2 | **Competing sign-ins: the last answer wins** | Includes a delayed password-change answer restoring the account that changed its password (the app has no screen for that today) | §38.5 |
| 3 | **Session binding is optional** | A client that sends no session name, an installed PWA on a cached older build included, is not protected by the server rule. Decide when to make the header mandatory | §38.2 |
| 4 | **A staff request refused after the role and age guard still extends the idle deadline** | Scope inside the service, the 15-minute window, a stale revision, invalid input, a rate limit. From the order of the code; no test of its own. Bounded by the 12-hour age limit | §38.4 |
| 5 | **An expired staff screen stays visible until the next staff request** | Private data already loaded stays on an unattended or returned-to screen; the server serves and changes nothing more | §38.4 |
| 6 | **Automated requests count as staff work** | A script, a future polling screen, or a browser reloading a discarded staff tab. Bounded by the 12-hour age limit | §38.4 |
| 7 | **A stale tab shows its old screen until it hears of an account change** | What it shows was fetched for its own account | §23.2 |
| 8 | **A change already sent may complete** as the person who sent it, after another account signed in | No automatic resend exists | §23.1, §23.2 |
| 9 | **A new flow that waits before sending must check the identity stamp** | A convention: nothing fails automatically if one doesn't | §23.1 |
| 10 | **The database does not force `staff_revision` to advance** | A hand-written change to roles or scopes bypasses it; least-privilege credentials (§16 item 4) apply | `DATA_MODEL.md` §23 |
| 11 | **Verification gaps** | Deferred real-backend specs; only part of the Grocery staff journey on a real backend; no late-response reordering in a real browser; no Safari, Firefox, real device or screen reader | `TESTING.md` |

## 21. Opening hours to midnight and the daily limit (GROCERY-4B)

- **No migration, configuration or environment change.** Alembic head stays `0013`.
- **Deploy the backend, then the frontend.** The new frontend against an older backend can't save midnight (the older code refuses `00:00`). The older frontend against the new backend works, but writes a midnight closing as `12:00 am` and its settings form rejects it.
- **Daily submission limit:** the day now starts at midnight in Karachi. The counters are keyed by the window's start, so **at deployment each account's count for the current day starts again once**.
- **Rolling back:** older code reads a stored midnight closing as `23:59` and closes at the day's last instant, so ordering keeps working; its settings screen shows `23:59`, and saving the closing time there replaces midnight with that.

### 21.1 Owner: set the approved hours and delivery coverage (after this version is running)

1. Sign in as a Super Admin (staff sign-in), within the last 12 hours.
2. Open **Grocery** → **Grocery settings**.
3. **Delivery blocks:** add each block or sector from **your verified list** of B-17, one at a time, spelled as customers should read it (up to 100, 40 characters each). Customers choose from exactly this list, and the server refuses any other. The application ships with no block names and suggests none.
4. **Operating days:** all seven. **Opens at:** `8:00 AM`. **Closes at:** `12:00 AM` (midnight at the end of the day).
5. Check **Orders per day** (default 10), **Largest order total** (default Rs 20,000), open orders per customer (2) and items per order (50).
6. **Review changes** → check the list → **Save settings**.
7. **Leave "Accept new grocery orders" off** until the launch blockers (§15–§17, §20) are cleared. Switching it on needs its own tick.
8. Check `/grocery`: it should read "Every day — 8:00 AM to 12:00 Midnight (Pakistan time)." and list your blocks.

**Payment methods:** nothing to configure. Only cash on delivery exists.
