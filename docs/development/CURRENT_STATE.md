# B-17 Portal — Current Development State

## Last Updated

2026-09-28

## Current Branch

master

## Current Verified Commit

51293d6 Phase 9B: upgrade advanced search and discovery
Phase 9C commit: pending (implementation complete, review passed, not yet committed)

## Current Phase

Phase 9C — Resident Experience: implementation complete, reviewed (READY FOR COMMIT), commit pending approval.
Next: Phase 9D — Professional Workspace.

## Completed Product Work

- Prototype foundation, design tokens, global shell (Phase 1)
- Home + Search/Explore discovery experience (Phase 2)
- Services + Provider profiles (Phase 3A)
- Demo auth + service request flow (Phase 3B)
- Provider/business onboarding (Phase 4A) + admin approval/moderation (Phase 4B)
- News & Daily Updates (Phase 5A) + Content Admin (Phase 5B)
- Education & tutor profiles (Phase 6A) + Property discovery/details (Phase 6B)
- Business Directory & business profiles (Phase 7A)
- Onboarding fixes: multiple listings per user, listing images, Property listing type
- Production-polish audit (Phase 8A) and fixes: tablet header overflow (8B), image asset optimization (8C), 404/Not Found page (8D), hero image visibility (8D)
- Production V1 frontend audit (full 20-section audit + Phase 9 roadmap)
- Phase 9A — Frontend Architecture Foundation (see below)
- Phase 9B — Advanced Search & Discovery (see below)
- Phase 9C — Resident Experience (see below)

Full history is in `git log`; this file summarizes outcomes, not the blow-by-blow.

## Current Architecture

- React 19 + TypeScript (strict) + Vite 8 SPA, no SSR.
- Three route trees under `createBrowserRouter`: `ConsumerLayout` (Header/Footer/MobileNav), `ProviderLayout`, `AdminLayout`. All routes are statically imported — no code splitting yet.
- `src/services/search.ts` is the single public read-data seam for all domain content (providers, businesses, tutors, properties, news, sponsored cards, plus category/subject/type tile enumeration). Components must not import `@/data/*` domain arrays directly — confirmed and enforced as of Phase 9A.
- Three Zustand stores: `listingsStore` (provider/business/property listing lifecycle: pending → approved/rejected) and `newsStore` (draft/published) are in-memory only, reset on reload. `residentStore` (Phase 9C — saved items + request history) additionally persists to `localStorage` via Zustand's own `persist` middleware; it is cleared on explicit resident Log Out (see Phase 9C Result).
- Demo-only auth: `useAuth()`/`useAdminAuth()`, name-only sessions, no password, no backend. Already consumed only through their public hooks everywhere (verified in Phase 9A). `AuthProvider.logout()` also clears `residentStore` — see Phase 9C Result.
- Static seed data lives in `src/data/*.ts`, typed via `src/types/*.ts`.
- TypeScript strict mode enabled (Phase 9A) — zero errors, no `any`, no suppressions needed.
- No PWA (no manifest, no service worker, no install prompt).
- No backend, no database, no real API calls anywhere.
- No test suite configured.

## Phase 9A Result

- `strict: true` enabled in `tsconfig.app.json` — tested first, zero TypeScript errors, kept.
- 4 components' direct dynamic-domain data imports removed (`DirectoryPage`, `EducationPage`, `PropertyPage`, `SponsoredSection`) — they now go through `search.ts` like every other domain consumer.
- 5 new functions added to `search.ts`: `getBusinessCategories`, `getTutorSubjects`, `getPropertyListingTypes`, `getPropertyTypes`, `getSponsoredCards`.
- No dependency added, no package.json change.
- No visible behavior change (verified live across Home, Directory, Education, Property, Services, a provider profile, a business profile, News, Login, 404, Coming Soon, Admin Moderation).
- Build passes, lint warning baseline unchanged (8 pre-existing warnings), no test suite exists to run.
- Static app configuration (`site.ts`, `serviceCategories.ts`, `discoveryCategories.ts`) intentionally still direct-imported — documented distinction from dynamic listing data, not an oversight.

## Phase 9B Result

- Contextual per-type filters added to Search/Explore (Provider: Category/Area; Business: Category/Area; Tutor: Subject/Grade/Area; Property: Listing Type/Property Type/Bedrooms/Furnishing/Area; News: Category) — each field backed by a real, existing seed-data property, verified by reading all 5 seed files directly.
- URL remains the single source of truth for type/filters/sort/q — all mutations go through `setSearchParams`'s functional updater form; no parallel local state.
- Active-filter chips render for every applied filter/type/sort, each individually removable.
- Sort is scoped to News only ("Newest", by `publishedAt`) — the only domain type with a real timestamp field.
- Client-side "Load More" pagination added to `useSearchResults` (`PAGE_SIZE = 12`), an explicit stand-in for a future real paged API, not an imitation of one.
- Price filtering/sorting intentionally NOT implemented — `Property.price` is a formatted string ("PKR 2.2 Cr"), not numeric; faking it was rejected per the data-honesty requirement.
- No dependency added. Build passes. TypeScript strict passes with zero errors. Lint stays at the existing 8-warning baseline (no new warnings). No test suite exists to run.
- Reviewed via `review-phase`: verdict READY FOR COMMIT.

## Phase 9C Result

- Replaced the `/profile` stub with a real resident workspace: Overview / Saved / My Requests, auth-gated via the existing `useRequireAuth()`.
- Saved/Favorites added across all 4 public listing types (Provider/Business/Tutor/Property — News excluded, no product reason to bookmark an article) via one shared `SaveButton` component.
- Saved items are stored as stable `{kind, id}` references, never deep copies — always resolved live through `search.ts` at render time.
- My Requests history/detail/status UI added; submitting a service request now creates exactly one local `ServiceRequestRecord` in `residentStore` (status always `"submitted"` — no fake transitions; the type supports future provider-side statuses for Phase 9D).
- `residentStore` (new Zustand store) persists saved items + request history to `localStorage` via Zustand's own `persist` middleware — no new dependency.
- Explicit resident Log Out clears `residentStore` (saved items + request history) — the actual privacy boundary for this demo, since demo auth has no stable user id to scope by. An ordinary reload (not a Log Out) still leaves the data in place to reappear after logging back in.
- Demo auth itself remains unchanged: in-memory only, not persisted, no real backend, no real account.
- No dependency added. Build passes. TypeScript strict passes with zero errors. Lint stays at the existing 8-warning baseline (no new warnings). No test suite exists to run.
- Reviewed via `review-phase` across three passes (initial → 2 blocking fixes → final): verdict READY FOR COMMIT.

## Production V1 Direction

- Complete the frontend before the backend.
- Advanced search & discovery (filters, sort, pagination contract).
- Resident experience (profile, saved/favorites, request history, notifications UI shell).
- Professional Workspace (shared shell, profession-specific modules).
- Free/Premium foundation (capability model, no billing yet).
- Admin production UX (user management, verification, moderation history).
- Mobile/PWA (manifest, service worker, installability).
- Performance/code splitting (route-level `React.lazy`).
- Notifications + trust/reviews UI shells.
- Accessibility/SEO/cleanup + final frontend QA.

## Known Technical Debt

- One large, eagerly-loaded JS bundle (~783 KB) — no route-level code splitting yet.
- No PWA (manifest/service worker/icons all absent).
- No notifications UI yet.
- Resident state (`residentStore`) has no stable user id to scope by — demo auth is name-only, so per-account scoping is not real; explicit Log Out (not reload) is the only privacy boundary today. Real account scoping belongs to the backend/API phase (Phase 12).
- No provider-side request status transitions yet (Phase 9D) — every resident request stays `"submitted"`.
- Auth is demo-only (name string, no password, no persistence) — by design, not yet a gap to "fix," but must become real before any production launch.
- No backend, no database — all state is static seed data + in-memory or `localStorage`-persisted Zustand.
- No test suite of any kind.
- Lint baseline: 8 pre-existing warnings (6× `only-export-components` in shadcn-pattern files, 2× `set-state-in-effect`) — known, unchanged across many phases.
- 19 orphaned images (~46 MB) in `public/images` awaiting a keep/wire/remove decision.
- Dead route `/services/home-construction` (defined, wired, but no inbound link anywhere).
- `shadcn` CLI package sits in `dependencies` instead of `devDependencies` (zero runtime impact, hygiene only).
- No SPA-fallback hosting config (`vercel.json`/`netlify.toml`/`_redirects`) — will 404 on refresh/direct link on a real static host until added.

## Do Not Build Yet

- Marketplace
- Pharmacy
- Pick & Drop
- Community Activities
- B-17 Vault
- Real payments
- Native Android/iOS apps
- Full production RBAC before the backend exists
- Speculative profession-specific modules without explicit approval

## Next Step

Phase 9D — Professional Workspace.

## Resume Instructions

A future Claude session should, in order:
1. Read `CLAUDE.md`.
2. Read this file (`CURRENT_STATE.md`).
3. Read `ROADMAP.md`.
4. Read `DECISIONS.md`.
5. Inspect `git status`.
6. Inspect recent `git log`.
7. Read only the docs/code relevant to the next phase.
8. Confirm the actual current state before modifying anything — this file is a summary, not a substitute for checking the live repository.
