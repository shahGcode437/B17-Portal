# B-17 Portal API (backend)

FastAPI backend. Architecture, data model and contracts are specified in [`docs/backend/`](../docs/backend/BACKEND_ARCHITECTURE.md) — this file only covers day-to-day commands.

**Current scope (Phase 10B):** application foundation only — `GET /api/v1/health`, settings, CORS, request IDs, structured logs, the error envelope, tests. No database, auth or domain APIs yet.

## Setup (once)

Requires Python 3.12+. The virtual environment is project-local (`backend/.venv`, git-ignored).

```powershell
# Windows PowerShell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
Copy-Item .env.example .env   # optional; development works without it
```

```bash
# macOS / Linux / Git Bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Git Bash on Windows: source .venv/Scripts/activate
pip install -e ".[dev]"
cp .env.example .env             # optional
```

## Run

```bash
uvicorn app.main:app --reload
```

- Health: <http://127.0.0.1:8000/api/v1/health>
- Interactive docs: <http://127.0.0.1:8000/docs> (OpenAPI at `/api/v1/openapi.json`; neither is published when `ENVIRONMENT=production`)
- Run it from `backend/` so `.env` is found. Configuration: `.env.example` documents every variable.

## Test and check

```bash
pytest                    # no database or network needed
ruff check .              # lint
ruff format --check .     # formatting (use `ruff format .` to fix)
mypy                      # strict type check
```

CI (`.github/workflows/backend-ci.yml`) runs exactly these four commands.
