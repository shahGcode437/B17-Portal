# B-17 Portal — Current Development State

## Last Updated

2026-09-30

## Current Branch

master

## Current Verified Commit

19a8d8e Phase 9D: build professional workspace with listings, leads, and status management
Phase 9E commit: pending (implementation complete, review passed, not yet committed)

## Current Phase

Phase 9E — Free/Premium Foundation: COMPLETE, reviewed (READY FOR COMMIT), commit pending approval.
Next frontend step: Visual/UI Refresh Planning — `docs/development/DESIGN_SYSTEM.md` will be created before any visual/theme changes begin.

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
- Phase 9D — Professional Workspace (see below)
- Phase 9E — Free/Premium Foundation (see below)

Full history is in `git log`; this file summarizes outcomes, not the blow-by-blow.

## Current Architecture

- React 19 + TypeScript (strict) + Vite 8 SPA, no SSR.
- Three route trees under `createBrowserRouter`: `ConsumerLayout` (Header/Footer/MobileNav), `ProviderLayout` (now a full Professional Workspace shell — Overview/Listings/Leads/Profile nav, Phase 9D), `AdminLayout`. All routes are statically imported — no code splitting yet.
- `src/services/search.ts` is the single public read-data seam for all domain content (providers, businesses, tutors, properties, news, sponsored cards, plus category/subject/type tile enumeration). Components must not import `@/data/*` domain arrays directly — confirmed and enforced as of Phase 9A.
- Four Zustand stores: `listingsStore` (provider/business/property listing lifecycle: pending → approved/rejected, plus `archived` as of Phase 9D; `selectActiveListingsBySubmitter`/`isListingCountedTowardPlanLimit` added Phase 9E for the Free listing-limit check) and `newsStore` (draft/published) are in-memory only, reset on reload. `residentStore` (Phase 9C — saved items + request history; Phase 9D added `updateRequestStatus`) and `planStore` (Phase 9E — the mocked local Free/Premium plan) both persist to `localStorage` via Zustand's own `persist` middleware; both are cleared/reset on explicit resident Log Out (see Phase 9C/9E Results).
- Demo-only auth: `useAuth()`/`useAdminAuth()`, name-only sessions, no password, no backend. Already consumed only through their public hooks everywhere (verified in Phase 9A). `AuthProvider.logout()` also clears `residentStore` and resets `planStore` — see Phase 9C/9E Results.
- Free/Premium capability model (Phase 9E): `Plan → PlanEntitlements → Capability`, centralized in `types/entitlements.ts`/`config/plans.ts`, consumed only via `useCapability`/`usePlanEntitlements`/`<RequireCapability>` — never a scattered `plan === "premium"` check. Frontend-only UX gating, explicitly not a security boundary.
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

## Phase 9D Result

- `ProviderLayout` is now a shared Professional Workspace shell — Overview / Listings / Leads / Profile, one shell for every listing kind (no separate app per profession).
- Listings: edit (reuses the onboarding forms, resubmits and resets status to `pending` regardless of prior status — an edit always goes back through moderation) and archive (one-way; `archived` added to `ListingStatus`, so an archived listing simply stops matching `search.ts`'s `status === "approved"` checks — no new filtering logic needed).
- Leads: derived from real ownership — a request only appears for a professional if its `providerId` matches a Provider-kind listing they themselves submitted (`submittedBy === user.name`). Leads are not filtered by the listing's current status, so archiving/rejecting a listing later doesn't erase its real lead history.
- Resident (`My Requests`) and professional (`Leads`) views read the exact same `residentStore.requests` record — no duplicate "providerRequests" store. Manual status transitions (submitted → accepted → in-progress → completed, cancel from any non-terminal state) go through one new `updateRequestStatus` action; no timers, no automatic transitions.
- Professional Profile/Settings uses only what demo auth and `listingsStore` already contain (name, listing-type summary, links to approved public listings) — no invented verification/billing/team/analytics fields.
- No dependency added. No backend/fake network calls. No premium/entitlement code (that's Phase 9E). Build passes. TypeScript strict passes with zero errors. Lint stays at the existing 8-warning baseline. No test suite exists to run.
- Reviewed via `review-phase`: verdict READY FOR COMMIT. Committed as `19a8d8e`.

## Phase 9E Result

- Centralized, typed `Plan → PlanEntitlements → Capability` architecture (`types/entitlements.ts`, `config/plans.ts`, `state/planStore.ts`, `hooks/useCapability.ts`, `components/access/RequireCapability.tsx`) — the only vocabulary feature code uses to decide what a professional can do.
- Two plans only: `free`/`premium`. `planStore` is a mocked, local, `localStorage`-persisted plan source (no backend, no fake HTTP) — explicitly documented as a UX control only, not a security boundary; real authorization will live in the backend once it exists.
- **Analytics** is the one real gated Premium example (`analytics.basic` capability): a genuine listings/leads status breakdown derived from existing store data, locked behind a real preview (not a blank page) for Free professionals.
- **Upgrade page** (`/provider/upgrade`): Free vs. Premium comparison, no pricing, no payment button, no checkout — the only interactive control is a demo-labeled plan toggle ("no real payment or subscription"), matching this prototype's existing "(demo)" affordance convention.
- **Free active-listing limit = 3.** Only `pending` and `approved` listings count toward it (`isListingCountedTowardPlanLimit`/`selectActiveListingsBySubmitter` in `listingsStore.ts`); `rejected` and `archived` listings do not consume the quota, and archiving a listing genuinely frees a slot immediately — fixed after an initial review caught the opposite (lifetime-cap) behavior. Premium has no numeric cap in the current frontend model (`maxListings: null`).
- `maxListings` (on `PlanEntitlements`) is the single value every limit check reads; `listings.extended` is a separate, reserved/display-oriented capability (shown in the Upgrade comparison table) that does **not** control the numeric quota — both files' doc comments cross-reference this explicitly to avoid future confusion.
- Explicit resident Log Out resets the demo plan to Free (`AuthProvider.logout()` → `planStore.resetPlan()`), mirroring the same privacy-boundary pattern established for `residentStore` in Phase 9C.
- No dependency added. No billing/payment/backend implementation of any kind. Build passes. TypeScript strict passes with zero errors. Lint stays at the existing 8-warning baseline. No test suite exists to run.
- Reviewed via `review-phase` across three passes (initial → 1 blocking fix [listing-limit counting semantics] → final): verdict READY FOR COMMIT.

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
- Professional/listing ownership (Phase 9D) is also name-based (`submittedBy === user.name`) — same demo-auth limitation, not a new one. Real auth/ownership belongs to the backend phase.
- Archived listings have no unarchive action yet (one-way in Phase 9D).
- Business/Property listings don't produce service leads — no request-capture flow exists for those kinds yet, only Provider's Request Service does.
- `listingsStore` is still in-memory only (reset on reload) — unaffected by Phase 9D/9E; `residentStore` and `planStore` (Phase 9E) are the two `localStorage`-persisted stores.
- Minor cleanup noted in Phase 9D review, not yet actioned: an unused `routes.editListing` path constant, and `resubmitListing` has no store-level status guard (archived-listing protection lives only in `EditListingPage`'s UI).
- Plan (Phase 9E) is demo/local only, not tied to any real account — same name-based limitation as everything else in this prototype; a determined user can switch their own plan, which is the explicit point of the demo Upgrade toggle. Real plan/subscription state belongs to the backend phase.
- Frontend capability checks (Phase 9E) are UX only, not authorization/security — explicitly documented in `types/entitlements.ts`; the backend will be authoritative once it exists.
- No profession-specific Premium modules built yet (Tutor/Property/Salon, etc.) — `professional.modules` capability exists, reserved and unconsumed, for exactly this future use.
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

Visual/UI Refresh Planning. `docs/development/DESIGN_SYSTEM.md` will be created before any visual/theme changes begin.

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
