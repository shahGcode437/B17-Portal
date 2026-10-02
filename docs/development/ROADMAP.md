# B-17 Portal — Production Roadmap

High-level only — implementation details for each phase are worked out when that phase begins, against the actual repository state at the time. Do not treat scope below as final; confirm against `CURRENT_STATE.md` and the live repo before implementing.

---

## Phase 9A — Frontend Architecture Foundation
**STATUS: COMPLETE** (commit `aa2ef76`)

- Objective: prepare the frontend for future backend/API integration without changing visible behavior.
- Scope: TypeScript strict mode; closed direct `@/data/*` domain-import gaps behind `search.ts`.
- Out of scope: backend, fake REST calls, TanStack Query, Redux/RTK/GraphQL, PWA, Zustand replacement, entitlement system.
- Dependencies: none.
- Verification: build/lint clean, zero visible behavior change, confirmed live across all major routes.

## Phase 9B — Advanced Search & Discovery
**STATUS: COMPLETE** (commit `51293d6`)

- Objective: real per-domain filters, sort, and a scalable result-loading strategy.
- Delivered: contextual filters per type (Provider/Business/Tutor/Property/News), URL as single source of truth, active-filter chips, News-only "Newest" sort, client-side "Load More" pagination (`PAGE_SIZE = 12`).
- Deliberately not implemented: Property price filter/sort (`Property.price` is a formatted string, not numeric — would have required fabricating a numeric field); "recently viewed"; real backend pagination or ranking.
- Dependencies: none (builds on the Phase 9A `search.ts` seam). No new dependency added.
- Verification: build passes, TypeScript strict passes, lint at existing baseline, no regressions to existing Search behavior or other routes, reviewed via `review-phase` (READY FOR COMMIT).

## Phase 9C — Resident Experience
**STATUS: COMPLETE** (commit `e781a34`)

- Objective: give registered residents a real account experience.
- Delivered: resident Overview/Saved/My Requests workspace (replacing the `ComingSoonPage` stub) via the existing `useRequireAuth()`; Saved/Favorites across Provider/Business/Tutor/Property (stable `{kind, id}` references, not deep copies); My Requests history/detail/status UI, one local record created per submitted service request; new `residentStore` (Zustand + `localStorage` persistence, no new dependency); explicit resident Log Out clears saved items + request history (reload alone does not).
- Deliberately not implemented: real backend persistence, stable user ids/account scoping, provider-side status transitions, real notifications delivery, real reviews/ratings.
- Dependencies: none new (builds on Phase 9A's `search.ts` seam and existing `useAuth`/`useRequireAuth`).
- Verification: build passes, TypeScript strict passes, lint at existing baseline, no regressions to existing flows, reviewed via `review-phase` across three passes (2 blocking fixes resolved) — final verdict READY FOR COMMIT.

## Phase 9D — Professional Workspace
**STATUS: COMPLETE** (commit `19a8d8e`)

- Objective: consolidate Provider Dashboard into a shared "Professional Workspace" shell (Overview / Listings / Leads / Profile) usable by every listing kind.
- Delivered: shared workspace shell (`ProviderLayout` + `ProfessionalNav`) covering Provider/Business/Property listings; listing edit (reuses onboarding forms, resubmits to `pending`) and archive (one-way, new `archived` status); a Leads inbox derived from real provider-ownership matching (`submittedBy`/`providerId`), not fabricated relationships; resident My Requests and professional Leads share one `residentStore.requests` source of truth; manual request-status transitions (submitted→accepted→in-progress→completed, cancel); a minimal Professional Profile/Settings page.
- Deliberately not implemented: profession-specific modules (student/batch manager, booking manager, etc. — Phase 9E's capability model), unarchive, leads for Business/Property (no request-capture flow exists for those kinds), premium/entitlement code, backend persistence.
- Dependencies: none new (builds on Phase 9C's `residentStore` and the existing `listingsStore`/moderation lifecycle).
- Verification: build passes, TypeScript strict passes, lint at existing baseline, no regressions to existing listing creation/moderation flows, reviewed via `review-phase` — final verdict READY FOR COMMIT. Non-blocking cleanup noted, not yet actioned: unused `routes.editListing` constant; `resubmitListing` has no store-level status guard (enforced only in `EditListingPage`'s UI).

## Phase 9E — Free/Premium Foundation
**STATUS: COMPLETE** (commit `d3fa12f`)

- Objective: introduce a capability/entitlement model (frontend only, no billing).
- Delivered: centralized typed `Plan → PlanEntitlements → Capability` architecture (`useCapability`/`usePlanEntitlements`/`<RequireCapability>`), a mocked local `planStore` (Free/Premium, `localStorage`-persisted, reset on explicit logout); Analytics as the one real gated Premium example; an Upgrade/plan-comparison page with no pricing or payment flow; a Free active-listing limit of 3 where only `pending`/`approved` listings count (`rejected`/`archived` don't consume the quota — archiving genuinely frees a slot); Premium has no numeric listing cap.
- Deliberately not implemented: billing/payment/subscription backend, real plan persistence, any full profession-specific Premium module (`professional.modules` capability is reserved, unconsumed).
- Dependencies: none new (builds on Phase 9D's workspace shell and Phase 9C's `persist`-store pattern).
- Verification: build passes, TypeScript strict passes, lint at existing baseline, no regressions to existing flows, reviewed via `review-phase` across three passes (1 blocking fix: listing-limit counting semantics) — final verdict READY FOR COMMIT. `maxListings` controls the numeric quota; `listings.extended` is reserved/display-oriented and does not control it — documented explicitly in both `types/entitlements.ts` and `config/plans.ts` to avoid future confusion.

---

## Visual/UI Refresh Planning
**STATUS: COMPLETE**

- Objective: plan a visual/theme refresh for the frontend before making any styling changes.
- Delivered: a read-only Visual/UI audit (design-system inventory, consumer/professional/admin flow audit, imagery/color/typography/motion/accessibility/responsive findings, root-cause analysis, P0–P3 prioritized recommendations) followed by `docs/design/DESIGN_SYSTEM.md` — the single visual-design source of truth (vision, principles, color/typography/spacing/radius/elevation system, the Card primitive design spec, imagery rules, per-surface component guidance, forms/buttons/badges/navigation/motion/responsive/accessibility rules, dark-mode status, anti-patterns, and the Visual Phase V1–V6 migration strategy).
- Out of scope (unchanged): implementing the refresh itself — that begins with Visual Phase V1 below.
- Dependencies: none.
- Verification: `docs/design/DESIGN_SYSTEM.md` exists and accurately reflects the current design system; no source/CSS/token changes were made while producing it.

## Visual Phase V1 — Shared Card Primitive + Surface Foundation
**STATUS: COMPLETE** (commit `b74760e`)

- Objective: introduce a reusable, presentation-only `Card` surface primitive centralizing the border/radius/background/shadow/interactive-hover behavior duplicated across domain cards, per `docs/design/DESIGN_SYSTEM.md` §8.
- Delivered: `src/components/ui/card.tsx` (variants `default`/`interactive`/`elevated`/`workspace`/`featured`); `ProviderCard`/`BusinessCard`/`TutorCard`/`PropertyCard` migrated to compose it (`variant="interactive"`), removing a verbatim-duplicated wrapper class string that previously existed independently in each file. `CardImage`/`PlaceholderImage`, keyboard/navigation/Save/CTA behavior, and the existing `cardHover` motion preset are all preserved unchanged — `Card` applies `cardHover` internally for `interactive`/`featured` variants rather than each card spreading it independently.
- Deliberately not implemented: migrating `CategoryCard` (renders as a `Link` with `compact`/`emphasis` props not yet mapped onto the variant set) or `ListingSummaryCard` (non-interactive, different padding/layout); the `elevated`/`workspace`/`featured` variants are defined but unconsumed; no Home/Hero/Search-filter/Directory/detail-page/workspace/admin/dark-mode/typography work — all explicitly out of scope for V1.
- Dependencies: none new (`package.json` unchanged).
- Verification: `npx tsc -b --force` and `npm run build` pass; lint remains at the established 8-warning baseline (a transient 9th warning from `card.tsx` exporting an unused `cardVariants` was fixed by making it module-private); responsive behavior reverified at 375px/820px/1440px; reviewed via `review-phase` — final verdict READY FOR COMMIT.

## Visual Phase V2 — Consumer Discovery/Card Refresh
**STATUS: COMPLETE** (commit `0f02378`)

- Objective: raise the visual confidence of consumer discovery surfaces per `docs/design/DESIGN_SYSTEM.md` §10/§23.
- Delivered: Search/Explore's control hierarchy reordered to SEARCH → FILTER → ACTIVE CRITERIA → RESULT COUNT → RESULTS; desktop filters grouped into a `Card`-surfaced panel; content-type toggle and active filter chips given a clearer primary-tinted selected state (scoped locally, not a shared-component change); results grid density raised 3→4 columns; `ResultCardSkeleton` migrated onto the shared `Card` surface; `ProviderCard`/`BusinessCard` wired to the (previously unconsumed) `featured` Card variant using real `featured` seed data only; all 4 domain-card titles given 2-line title clamping. Also fixed a real, verified Search UX bug: Home Hero's quick-search suggestion buttons navigated without syncing Hero's own controlled search input (`runSearch` now calls `setQuery(value)` before navigating) — `SearchPage`'s URL-as-source-of-truth architecture was confirmed already correct and left unchanged.
- Deliberately not implemented: Directory/Services changes (live verification showed both already have well-populated real category grids — the earlier audit's "sparse" finding was a stale-render tooling artifact, not a real gap); `CategoryCard`/`ListingSummaryCard`/`NewsCard` migration to `Card`; a custom themed Select to replace the native filter `<select>`s; any Home/Hero visual redesign beyond the one-line search-sync fix; detail-page, Professional Workspace, Admin, or dark-mode work.
- Dependencies: Visual Phase V1 (the `Card` primitive).
- Verification: `npx tsc -b --force` and `npm run build` pass; lint remains at the established 8-warning baseline; no new dependency; negligible bundle increase (+0.06% JS); live-verified quick-suggestion/manual-typing/Enter/clear/reload/back-forward/mobile search behavior, keyboard card activation, Save/Favorite, and quick-view dialogs all unchanged; reviewed via `review-phase` — final verdict READY FOR COMMIT.

## Visual Phase V2.1 — Contextual Search + Predictive Suggestions
**STATUS: COMPLETE** (commit `4e92833`)

- Objective: close two Search/Explore UX gaps before V3 — zero-result friction after a content-type switch with an active query, and no predictive/autocomplete search.
- Delivered: predictive suggestions built only from real, existing approved/published data (typed `SearchSuggestion` model; ranking exact → starts-with → word-prefix → contains; de-duplicated; capped at 8; type-specific), isolated behind `getSearchSuggestions` in `search.ts` and the `useSearchSuggestions` hook so a future backend `/search/suggestions` endpoint can replace it without UI changes; an accessible combobox `SearchBar` (mouse and keyboard, ArrowUp/Down/Enter/Escape, listbox semantics); immediate Enter commit and atomic suggestion selection (query + type + URL + results); contextual placeholders per type; contextual zero-result messaging with "clear search keeping the type" and "search all of B-17" actions. Fixed a real same-mount URL-sync bug by making the URL the sole committed state (the input is a draft that follows external navigation; the old local-state→URL effect and skip-ref were removed). Compact SearchBar input raised to 16px below `md` (was 14px) to avoid mobile focus-zoom; Hero chip "Solar installer" → "Solar" (the old phrase matched nothing).
- Deliberately not implemented: search history, trending searches, voice/AI search, a global search store, suggesting area or furnishing (exact-match filters already exist), deriving Hero chips from data, any backend search service.
- Dependencies: Visual Phase V2 (Search/Explore surface). No new dependency.
- Verification: `npx tsc -b --force` and `npm run build` pass; lint remains at the established 8-warning baseline; fresh browser console 0 errors / 0 warnings; verified typing/debounce, Enter, mouse and keyboard selection, Escape, clear, type switching, both zero-result actions, reload, Back/Forward, same-mount external navigation, Home quick-search, and 375/430/820/1440px; reviewed via `review-phase` — final verdict READY FOR COMMIT.
- Known limitations: Hero chips remain static strings; `updateParams` assumes browser history/`createBrowserRouter`; a future external REPLACE navigation into a mounted `/search` would be treated as the page's own write; real iOS keyboard not physically tested; no backend search service yet.

## Visual Phase V3 — Detail Pages + Imagery
**STATUS: COMPLETE** (Visual V3 commit: pending)

- Objective: implement the richer detail-page composition and a deliberate missing-image treatment per `docs/design/DESIGN_SYSTEM.md` §9/§11/§23.
- Delivered: shared, presentation-only detail primitives (`DetailLayout`, `DetailHero`, `DetailSummary`, `DetailSection`, `DetailFacts`, `DetailTagList`, `FeaturedBadge` in `src/components/detail/`) adopted by the Provider, Business, Tutor and Property detail pages; image-led cover; mobile-first cover → summary → CTA → facts → sections order with a sticky desktop summary/action panel; sections and facts built from real fields only (no fake ratings/reviews/trust signals); a captioned hero fallback for missing images (`size="hero"` on `PlaceholderImage`/`CardImage`); 44px CTAs and a 44×44 detail Save button; a long-token overflow bug fixed. News received only the shared hero treatment. Also a global accessibility fix: the light-mode primary, brand-accent and destructive tokens were darkened within their existing color families to reach ≥4.5:1 text contrast (5.48 / 5.18 / 5.45:1), with a darker default-Button hover — documented in `DESIGN_SYSTEM.md` §4/§15; dark-mode tokens unchanged.
- Deliberately not implemented: ratings/reviews/maps/verification, related-content recommendations, image galleries/carousels (only one image per item exists), real upload/storage, new demo photography (Business Directory photo *coverage* is still uneven — only its fallback presentation improved), the unconsumed `Card` variants, migrating `NewsCard`/`CategoryCard`/`ListingSummaryCard`, any search/workspace/admin/dark-mode work.
- Dependencies: Visual Phase V1 (the `Card` primitive), Visual Phase V2. No new dependency.
- Verification: `npx tsc -b --force` and `npm run build` pass; lint remains at the established 8-warning baseline; fresh browser console 0 errors / 0 warnings; verified at 375/430/820/1440px (cover, summary column, sticky behavior, CTA size/alignment, overflow, long-content and image-shape resilience), plus keyboard order/focus, Save, CTA behavior, Back and the login-resume flow; button states (default/hover/focus/disabled/outline/destructive) re-measured after the contrast change; reviewed via `review-phase` — final verdict READY FOR COMMIT.
- Known follow-ups: warning/success/info status-badge contrast (about 2.71/2.79/4.19:1) and a dedicated focus-indicator contrast review; Featured badge markup duplicated between cards and `FeaturedBadge`; real-device testing pending; demo imagery will be replaced by real client/user media.

## Visual Phase V4 — Resident + Professional Workspace Polish
**STATUS: NEXT**

- Objective: apply the shared `Card` primitive (`workspace` variant) and typography/spacing polish to Resident and Professional Workspace surfaces per `docs/design/DESIGN_SYSTEM.md` §12/§23.
- Major scope: to be confirmed against the live repo when this phase begins — likely Overview stat tiles, Listings/Leads rows (`ListingSummaryCard`), Profile/Settings, and the status-badge contrast follow-up noted above.
- Out of scope: new workspace features/modules, capability/entitlement logic changes, Admin redesign (Visual V5), dark mode, typography changes.
- Dependencies: Visual Phase V1 (the `Card` primitive); Phase 9C–9E (the surfaces being polished).
- Completion/verification: no change to capability-gating, lead/request status behavior or listing-limit logic (visual only); responsive re-check at 375px/820px/1440px.

## Phase 9F — Admin Production UX

- Objective: close the most visible Production V1 admin gaps.
- Major scope: user list/detail (against mock users), verification-state UI, sponsored/ad CRUD screen, moderation-history view.
- Out of scope: real RBAC enforcement, real audit persistence (backend-dependent).
- Dependencies: none new.
- Completion/verification: screens exist and function against mock data; existing moderation behavior unchanged.

## Phase 9G — Mobile/PWA

- Objective: make the app installable and offline-tolerant for static assets.
- Major scope: manifest, icon set, service worker (via `vite-plugin-pwa`), per-route `<title>`/meta.
- Out of scope: push notifications (needs a backend + push provider), native apps.
- Dependencies: none.
- Completion/verification: app installable in Chrome/Edge, Lighthouse PWA checks pass, no change to existing routes/behavior.

## Phase 9H — Performance & Route Splitting

- Objective: reduce initial bundle size.
- Major scope: convert `router.tsx`'s eager imports to `React.lazy` + `Suspense`, prioritizing Admin/Provider and heavy detail pages.
- Out of scope: broader architecture changes.
- Dependencies: none.
- Completion/verification: measurably smaller initial chunk, no navigation regressions.

## Phase 9I — Notifications + Trust/Reviews UI

- Objective: add a notification center UI shell.
- Major scope: bell icon + notification list populated from mock/local events (e.g., "listing approved").
- Out of scope: real push delivery, real reviews/ratings (still explicitly prohibited per product principles unless a real verification process exists).
- Dependencies: Phase 9C (requests) and Phase 9F/9D (approvals) for events to notify about.
- Completion/verification: shell renders and reflects mock events; no fabricated trust signals introduced.

## Phase 9J — Accessibility + SEO + Cleanup + Final Frontend QA

- Objective: close remaining polish items before backend work begins.
- Major scope: automated a11y tooling pass, resolve the dead `servicesConstruction` route, decide/act on the 19 orphaned images, move `shadcn` to `devDependencies`, final full-app QA pass.
- Out of scope: anything requiring a backend.
- Dependencies: none — good "cool-down" phase.
- Completion/verification: clean audit re-run, no known regressions across all Phase 9 work.

---

## Phase 10 — Backend Architecture/Foundation
Backend project setup and architecture (FastAPI, planned). Not started.

## Phase 11 — PostgreSQL/Data Layer
Real schema/data layer design and implementation. Not started.

## Phase 12 — Frontend/API Integration
Replace `search.ts`'s mock implementation and the Zustand stores' local mutations with real API calls, using the boundaries established in Phase 9A onward. Not started.

## Phase 13 — Security/Auth/RBAC/Storage/Deployment
Real authentication, authorization/RBAC, media/object storage, and production deployment. Not started.
