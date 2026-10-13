# B-17 Portal API (backend)

FastAPI + PostgreSQL backend. Architecture, data model and contracts are specified in [`docs/backend/`](../docs/backend/BACKEND_ARCHITECTURE.md) — this file only covers day-to-day commands.

**Current scope (Phase 10C):** application foundation plus the PostgreSQL data layer — 15-table schema, Alembic migrations, reference taxonomy seed, dev fixtures, `GET /api/v1/health` (liveness) and `GET /api/v1/health/ready` (database). No product/read/auth APIs yet (Phase 10D onward).

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
python -m scripts.dev_fixtures     # OPTIONAL demo users/listings with fixed ids; refuses production
```

- The host port is **54329**, not 5432, so it never collides with a PostgreSQL installed on your machine. Change it with `POSTGRES_PORT`.
- Everything the app writes is governed by Alembic: change a model → `alembic revision --autogenerate -m "what changed"` → **review and edit the generated file** → `alembic upgrade head` → `alembic check` (must report no drift).
- `docker compose down` stops it and keeps your data (named volume); `docker compose down -v` deletes the data.

## Run

```bash
uvicorn app.main:app --reload
```

- Liveness: <http://127.0.0.1:8000/api/v1/health> — always 200 while the process is up.
- Readiness: <http://127.0.0.1:8000/api/v1/health/ready> — 200 only when PostgreSQL answers; otherwise a safe 503.
- Interactive docs: <http://127.0.0.1:8000/docs> (OpenAPI at `/api/v1/openapi.json`; none of it is published when `ENVIRONMENT=production`).
- Run from `backend/` so `.env` is found. `.env.example` documents every variable.

Optional — the API in a container, against the Compose database:

```bash
docker compose --profile api up -d --build --wait api     # http://127.0.0.1:8000
docker compose run --rm api alembic upgrade head          # migrations are an explicit step, never run on boot
```

## Test and check

```bash
pytest                    # 125 database-free tests always run; the 166 PostgreSQL tests need TEST_DATABASE_URL
ruff check .              # lint
ruff format --check .     # formatting (use `ruff format .` to fix)
mypy                      # strict type check (app, tests, scripts)
alembic check             # models vs migrations (needs DATABASE_URL)
```

**Test database safety.** The PostgreSQL tests *reset their schema*, so they only run against a database that is explicitly named in `TEST_DATABASE_URL`, whose **name ends in `_test`**, on a local host (`localhost`, `127.0.0.1`, `::1`, or the Compose service `db`), and that differs from `DATABASE_URL`. Anything else makes the suite fail loudly instead of running (see `tests/db_safety.py`). If `TEST_DATABASE_URL` is unset, the PostgreSQL tests are skipped locally but **fail in CI** (`CI` set). `DATABASE_URL` is removed from the environment for every test. Tests never use SQLite.

CI (`.github/workflows/backend-ci.yml`) runs lint, format, mypy, `alembic upgrade head`, `alembic check`, the seed (twice), and the full `pytest` against a PostgreSQL service container, plus a Docker image build.
