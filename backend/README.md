# B-17 Portal API (backend)

FastAPI + PostgreSQL backend. Architecture, data model and contracts are specified in [`docs/backend/`](../docs/backend/BACKEND_ARCHITECTURE.md) — this file only covers day-to-day commands.

**Current scope (Phase 12F):** application foundation, the PostgreSQL data layer (Alembic migrations `0001`–`0005` — `0005` adds the shared listing location columns, reference taxonomy seed, dev fixtures), health/readiness, the **public read APIs** (categories, search, suggestions, listing detail, news — `docs/backend/READ_API_PARITY.md`) and **email/password authentication** (`/api/v1/auth/*`: register, login, me, logout, logout-all, verify-email, resend-verification, forgot-/reset-/change-password) with PostgreSQL sessions in an `HttpOnly` cookie, CSRF protection and an RBAC foundation (`docs/backend/AUTH_RBAC.md`), plus **Google sign-in** (`/api/v1/auth/oauth/google/{start,callback}`, `DELETE /api/v1/auth/oauth/google`: sign-in, Connect and Disconnect through the same sessions; a development fake provider needs no credentials). Since Phase 12D the **owner write API** (professional profile, listing create / edit / archive, owner reads — `docs/backend/API_CONTRACT.md` §11) and, since Phase 12E, the **admin API** (`/api/v1/admin/*`: moderation queue and detail, approve / reject / takedown with optimistic `revision`, category create / patch / reorder — §12) exist, and so do the **Saved and service-request APIs** (Phase 12F: `/api/v1/saved`, `/api/v1/requests`, `/api/v1/users/me/leads` — §13; migration `0006`; a preference-only contact model, no chat, contact data or payments); the frontend calls the backend only for authentication.

## Setup (once)

Requires Python 3.12+ and Docker (for PostgreSQL). The virtual environment is project-local (`backend/.venv`, git-ignored).

```powershell
# Windows PowerShell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
Copy-Item .env.example .env     # DATABASE_URL / TEST_DATABASE_URL match the Compose database below
```

```bash
# macOS / Linux / Git Bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Git Bash on Windows: source .venv/Scripts/activate
pip install -e ".[dev]"
cp .env.example .env
```

## Database

```bash
docker compose up -d --wait db     # PostgreSQL 17 on 127.0.0.1:54329; creates b17_dev and b17_test
alembic upgrade head               # create / update the schema (always via migrations)
python -m app.db.seed              # reference taxonomy (39 categories) — idempotent, safe everywhere
python -m scripts.dev_fixtures     # OPTIONAL demo users/listings/news with fixed ids; refuses production
python -m app.db.search_index rebuild   # after migrating an existing database: fills listings.search_document
python -m app.db.search_index check     # exits 1 if any stored search document is stale
```

- The host port is **54329**, not 5432, so it never collides with a PostgreSQL installed on your machine. Change it with `POSTGRES_PORT`.
- Everything the app writes is governed by Alembic: change a model → `alembic revision --autogenerate -m "what changed"` → **review and edit the generated file** → `alembic upgrade head` → `alembic check` (must report no drift).
- `docker compose down` stops it and keeps your data (named volume); `docker compose down -v` deletes the data.
- **Upgrading a database that already has listings to migration `0002`** (the search foundation) requires a one-time reindex: `alembic upgrade head`, then `python -m app.db.search_index rebuild`, then `python -m app.db.search_index check` (must report all documents current). Until then existing listings are not searchable. It is never run automatically on startup; see `docs/backend/DEPLOYMENT.md` §4.1.

## Run

```bash
uvicorn app.main:app --reload
```

- Liveness: <http://127.0.0.1:8000/api/v1/health> — always 200 while the process is up.
- Readiness: <http://127.0.0.1:8000/api/v1/health/ready> — 200 only when PostgreSQL answers; otherwise a safe 503.
- Read APIs (after `python -m scripts.dev_fixtures`; the examples below were run against that data):

  ```bash
  curl "http://127.0.0.1:8000/api/v1/search?q=biryani&limit=1"            # ranked mixed-kind search
  curl "http://127.0.0.1:8000/api/v1/search?type=property&listingType=rent"
  curl "http://127.0.0.1:8000/api/v1/search/suggestions?q=wa"             # ranked autocomplete
  curl "http://127.0.0.1:8000/api/v1/categories?module=food"
  curl "http://127.0.0.1:8000/api/v1/news"
  curl "http://127.0.0.1:8000/api/v1/listings/3743805c-06be-5ebe-a09d-bcd2560ccd0f"   # Capital Bakers (fixture id)
  ```

  Pending, rejected, archived and draft records, unknown ids and malformed ids all answer the same `404`.
  Every listing item also carries a public `location` (Phase 12B): `exact` listings expose their point (and, on detail, address / landmark), `approximate` ones only a 2-decimal rounded point, `area_only` and pre-`0005` legacy rows no point at all. After upgrading an existing development database to `0005`, run `python -m scripts.dev_fixtures` again to give the fixtures their synthetic demo locations (idempotent; it prints how many it relocated), then `python -m app.db.search_index check`. Verified example: `curl "http://127.0.0.1:8000/api/v1/listings/<Mocha Corner Cafe id>"` → `"location": {"visibility": "approximate", "block": "C", "coordinates": {"latitude": 33.71, "longitude": 73.06, "precision": "approximate"}}` (the stored point and the private address are never returned).
- Authentication (run the API with `uvicorn app.main:app` and use **`127.0.0.1` everywhere** — never mix in `localhost`; the verified examples below were run against that topology; browsers must send an allowed `Origin`, curl needs it explicitly):

  ```bash
  B=http://127.0.0.1:8000/api/v1; O="Origin: http://127.0.0.1:5173"; J="Content-Type: application/json"
  curl -i -c jar.txt -H "$O" -H "$J" -X POST $B/auth/register \
       -d '{"email":"me@example.org","password":"a long passphrase","displayName":"Me"}'   # 201 + Set-Cookie: b17_session
  curl -b jar.txt $B/auth/me                                                              # 200, includes csrfToken
  curl -b jar.txt -H "$O" -X POST $B/auth/logout                                          # 403 csrf_failed (no token)
  curl -b jar.txt -H "$O" -H "X-CSRF-Token: <csrfToken from /auth/me>" -X POST $B/auth/logout   # 204
  ```

  In development the email backend is `console`: verification/reset links (with the token in the URL fragment) are printed by the server. Make the first admin with `python -m app.cli.admin grant me@example.org` (needs a verified account) and purge expired auth data with `python -m app.cli.auth_maintenance purge`. Settings and the cookie/CSRF/session rules are in `.env.example` and `docs/backend/AUTH_RBAC.md`.
- Google sign-in, locally and offline. Google is `disabled` by default (the endpoints answer `503`). To exercise the whole flow without Google Cloud, run the API with the in-process fake provider (development/test only — it is refused when `ENVIRONMENT` is `staging` or `production`):

  ```bash
  GOOGLE_OAUTH_PROVIDER=fake uvicorn app.main:app          # callback URL: http://127.0.0.1:8000/api/v1/auth/oauth/google/callback
  ```

  ```bash
  B=http://127.0.0.1:8000/api/v1; O="Origin: http://127.0.0.1:5173"; J="Content-Type: application/json"
  curl -c jar.txt -H "$O" -H "$J" -X POST $B/auth/oauth/google/start -d '{"purpose":"login","returnTo":"/saved"}'
  #  -> {"data":{"authorizationUrl":"https://fake-google.invalid/authorize?...&state=<STATE>&..."}} and a b17_oauth flow cookie in jar.txt
  # The fake "Google" is driven by the authorization code: fake|<scenario>|<sub>|<email>|<verified 0/1>|<name>  (scenarios: ok, denied, invalid, timeout)
  curl -i -b jar.txt -c jar.txt -G $B/auth/oauth/google/callback \
       --data-urlencode 'code=fake|ok|sub-1|gina@example.org|1|Gina Khan' --data-urlencode 'state=<STATE>'
  #  -> 302 Location: http://127.0.0.1:5173/saved, Set-Cookie: b17_session=...  (the flow cookie is cleared)
  curl -b jar.txt $B/auth/me                                    # authMethods: {"password": false, "providers": ["google"]}
  ```

  Re-sending the callback, a wrong `state`, or a different browser (no `b17_oauth` cookie) ends at `302 …/login?error=oauth_failed`. To use real Google instead, see `docs/backend/DEPLOYMENT.md` §10 (`GOOGLE_OAUTH_PROVIDER=google` plus the client id/secret and `API_PUBLIC_BASE_URL`; the secret goes in your untracked `.env`, never in `.env.example`).
- Interactive docs: <http://127.0.0.1:8000/docs> (OpenAPI at `/api/v1/openapi.json`; none of it is published when `ENVIRONMENT=production`).
- Run from `backend/` so `.env` is found. `.env.example` documents every variable.

Optional — the API in a container, against the Compose database:

```bash
docker compose --profile api up -d --build --wait api     # http://127.0.0.1:8000
docker compose run --rm api alembic upgrade head          # migrations are an explicit step, never run on boot
```

## Test and check

```bash
pytest                    # 1191 database-free tests always run; the 1985 PostgreSQL tests (3176 total) need TEST_DATABASE_URL
ruff check .              # lint
ruff format --check .     # formatting (use `ruff format .` to fix)
mypy                      # strict type check (app, tests, scripts)
alembic check             # models vs migrations (needs DATABASE_URL)
```

**Test database safety.** The PostgreSQL tests *reset their schema*, so they only run against a database that is explicitly named in `TEST_DATABASE_URL`, whose **name ends in `_test`**, on a local host (`localhost`, `127.0.0.1`, `::1`, or the Compose service `db`), and that differs from `DATABASE_URL`. Anything else makes the suite fail loudly instead of running (see `tests/db_safety.py`). If `TEST_DATABASE_URL` is unset, the PostgreSQL tests are skipped locally but **fail in CI** (`CI` set). `DATABASE_URL` is removed from the environment for every test. Tests never use SQLite.

CI (`.github/workflows/backend-ci.yml`) runs lint, format, mypy, `alembic upgrade head`, `alembic check`, the seed (twice), and the full `pytest` against a PostgreSQL service container, plus a Docker image build.
