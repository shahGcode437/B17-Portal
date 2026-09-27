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
- Zustand 5 (two stores: listings, news) — no persistence, in-memory only
- `react-hook-form` + `zod` (via a hand-rolled resolver bridge)
- `motion` (animation), `lucide-react` (icons)
- No backend, no database, no real auth, no test suite yet
- Planned FUTURE backend direction: FastAPI + PostgreSQL — not implemented yet, do not assume it exists

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
