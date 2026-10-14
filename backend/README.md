# B-17 Portal API (backend)

FastAPI + PostgreSQL backend. Architecture, data model and contracts are specified in [`docs/backend/`](../docs/backend/BACKEND_ARCHITECTURE.md) — this file only covers day-to-day commands.

**Current scope (Phase 10D):** application foundation, the PostgreSQL data layer (15-table schema, Alembic migrations `0001`–`0002`, reference taxonomy seed, dev fixtures), health/readiness and the **public read APIs** — categories, search, suggestions, listing detail and news (`docs/backend/READ_API_PARITY.md`). No write, auth or owner/admin APIs yet (Phase 11 onward), and the frontend does not call the backend.

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
- Interactive docs: <http://127.0.0.1:8000/docs> (OpenAPI at `/api/v1/openapi.json`; none of it is published when `ENVIRONMENT=production`).
- Run from `backend/` so `.env` is found. `.env.example` documents every variable.

Optional — the API in a container, against the Compose database:

```bash
docker compose --profile api up -d --build --wait api     # http://127.0.0.1:8000
docker compose run --rm api alembic upgrade head          # migrations are an explicit step, never run on boot
```

## Test and check

```bash
pytest                    # 126 database-free tests always run; the 413 PostgreSQL tests need TEST_DATABASE_URL
ruff check .              # lint
ruff format --check .     # formatting (use `ruff format .` to fix)
mypy                      # strict type check (app, tests, scripts)
alembic check             # models vs migrations (needs DATABASE_URL)
```

**Test database safety.** The PostgreSQL tests *reset their schema*, so they only run against a database that is explicitly named in `TEST_DATABASE_URL`, whose **name ends in `_test`**, on a local host (`localhost`, `127.0.0.1`, `::1`, or the Compose service `db`), and that differs from `DATABASE_URL`. Anything else makes the suite fail loudly instead of running (see `tests/db_safety.py`). If `TEST_DATABASE_URL` is unset, the PostgreSQL tests are skipped locally but **fail in CI** (`CI` set). `DATABASE_URL` is removed from the environment for every test. Tests never use SQLite.

CI (`.github/workflows/backend-ci.yml`) runs lint, format, mypy, `alembic upgrade head`, `alembic check`, the seed (twice), and the full `pytest` against a PostgreSQL service container, plus a Docker image build.
