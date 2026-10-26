# B-17 Portal

Mobile-first hyperlocal portal for B-17, Islamabad: React + TypeScript + Vite frontend, FastAPI + PostgreSQL backend (`backend/`). Project docs: `docs/` (start with `docs/development/CURRENT_STATE.md`).

## Local development — the one supported way to run it

Needs Node 20.19+ (or 22.12+), Python 3.12+ and Docker. Three terminals (or background them):

```bash
# 1. PostgreSQL + schema + reference data (once; the data survives restarts)
cd backend
cp .env.example .env                 # first time only (PowerShell: Copy-Item .env.example .env)
python -m venv .venv && .venv/Scripts/pip install -e ".[dev]"     # first time only (macOS/Linux: .venv/bin/...)
docker compose up -d --wait db
.venv/Scripts/alembic upgrade head && .venv/Scripts/python -m app.db.seed
.venv/Scripts/python -m scripts.dev_fixtures      # OPTIONAL demo listings, so search / detail pages are not empty

# 2. The API on http://127.0.0.1:8000 (leave running)
cd backend && .venv/Scripts/python -m uvicorn app.main:app --reload

# 3. The app (leave running)
npm install                          # first time only
npm run dev                          # http://127.0.0.1:5173  -  http://localhost:5173 works too
```

**How the browser reaches the API.** The app calls `/api/v1/...` on *its own* origin and Vite proxies `/api` to the API (`vite.config.ts`; `B17_API_PROXY_TARGET` overrides the target). That is why the app works at `localhost:5173` **and** `127.0.0.1:5173` — one origin, a host-only session cookie, no CORS, and none of the backend's CSRF / Origin checks loosened. Both origins (and the `:4173` preview ones) are in `FRONTEND_ORIGINS` in `backend/.env`. The ports are fixed (`strictPort`): if `5173` is busy, `npm run dev` stops instead of silently moving to an origin the API does not allow. `npm run preview` (the built app) proxies `/api` the same way.

**New accounts and e-mail.** In development **no e-mail is sent**: the console backend only prints links in the API terminal. To verify an account you just registered (needed to create a Professional profile, a listing or a request), run:

```bash
cd backend && .venv/Scripts/python -m app.cli.dev_verify you@example.org --origin http://localhost:5173
```

and open the link it prints (use `--origin http://127.0.0.1:5173`, or omit `--origin`, if that is the address you browse). It issues a real one-time link — opening it runs the normal verification — and it refuses to run outside `ENVIRONMENT=development|test` or against a non-local database. Make an admin with `python -m app.cli.admin grant you@example.org` (the account must be verified first).

**Checks.** `npm test` (Vitest) · `npm run lint` · `npm run build` · `npx playwright test` (mock-contract suite, CI) · `npx playwright test -c playwright.real.config.ts` (the real-stack lane: needs the stack above, see `docs/development/TESTING.md`) · `cd backend && pytest`.

## Tooling notes (from the Vite template)

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
