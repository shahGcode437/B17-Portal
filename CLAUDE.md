# B-17 Portal

## Product

B-17 Portal is a mobile-first hyperlocal digital ecosystem for B-17, Islamabad.

Core journey:
Discover → Explore → Compare → Trust → Connect → Request → Return/Transact

## Current Product Direction

- Production V1 frontend is being completed first.
- Real backend/database integration comes afterward.
- Production V1 should be mobile-first and PWA-ready.
- Architecture must remain future-ready for dedicated Android/iOS clients using the same future backend APIs.
- Free + Premium business/professional model is planned.
- Premium functionality should be capability/entitlement-based, not scattered `if (premium)` checks.
- Prefer one shared Professional Workspace with profession-specific modules over separate apps per profession.
- Future modules such as Marketplace, Pharmacy, Pick & Drop, Community Activities, B-17 Vault, and real payments are outside current Production V1 unless explicitly approved.

## Current Stack

- React 19 + TypeScript (strict mode enabled) + Vite 8
- React Router 7 (`createBrowserRouter`)
- Tailwind CSS v4 (`@tailwindcss/vite`) + shadcn/ui (`radix-ui`)
- Zustand 5 is installed but no store holds server state (the listings / news stores went in Phase 12G; `residentStore` / `planStore` in Phase 12H) — the backend is the source of truth
- `leaflet` (direct, behind a `MapEngine` boundary, lazy-loaded; `react-leaflet` is not used)
- `react-hook-form` + `zod` (via a hand-rolled resolver bridge)
- `motion` (animation), `lucide-react` (icons)
- Authentication is real since Phase 12C (cookie session + in-memory CSRF against the Phase 11 backend; see `docs/backend/AUTH_RBAC.md` §23). Automated tests (Vitest + Playwright) exist since Phase 9M — see `docs/development/TESTING.md`
- Backend: FastAPI + PostgreSQL exist in `backend/` (Phase 10B–12F: health/readiness, settings, CORS, error envelope, a PostgreSQL schema with Alembic migrations `0001`–`0006` (including privacy-aware listing location), public read APIs for categories, search/suggestions, listing detail and news (listings carry a public `location`), and email/password plus Google authentication with PostgreSQL sessions + CSRF — see `docs/backend/`). The owner write API exists (Phase 12D: professional profile, listing create / edit / archive, owner list / detail) and so does the admin API (Phase 12E: moderation queue / detail, approve / reject / takedown, category create / patch / reorder; admin authority only from backend roles) and so do the Saved and service-request APIs (Phase 12F: `/saved`, `/requests`, `/users/me/leads`; preference-only contact model, no chat or payments), and, since Phase 12G, the frontend reads from the backend (public discovery / search / suggestions / detail / categories / news and the signed-in Saved, requests, leads, owner listings and admin queue / categories) with a Leaflet map for exact and approximate locations; and, since Phase 12H, the frontend also **writes** to it (professional profile, listing create / edit / archive with a map picker, Saved, service requests and their lifecycle, admin approve / reject / takedown, category create / patch / reorder); the plan and roles come only from `/auth/me`, and news administration remains unavailable (no backend API) — do not assume otherwise

## Engineering Workflow

Inspect → Plan → Implement → Verify → Report → Approval → Commit

## Engineering Rules

- Read relevant docs before implementing.
- Inspect existing code before creating new abstractions.
- Prefer existing patterns over new dependencies.
- Do not invent backend/API contracts.
- Avoid unrelated refactors.
- Avoid scope creep.
- Keep changes independently verifiable and committable.
- Run build/lint/tests where applicable.
- Review git diff/status before recommending a commit.
- Never commit or push unless explicitly approved.
- Preserve current behavior unless the phase specifically changes it.

## Project Memory

Before starting any new phase, read:
- `docs/development/CURRENT_STATE.md`
- `docs/development/ROADMAP.md`
- `docs/development/DECISIONS.md`
- relevant existing project docs in `/docs`
