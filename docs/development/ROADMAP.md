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
**STATUS: COMPLETE** (commit `d993992`)

- Objective: implement the richer detail-page composition and a deliberate missing-image treatment per `docs/design/DESIGN_SYSTEM.md` §9/§11/§23.
- Delivered: shared, presentation-only detail primitives (`DetailLayout`, `DetailHero`, `DetailSummary`, `DetailSection`, `DetailFacts`, `DetailTagList`, `FeaturedBadge` in `src/components/detail/`) adopted by the Provider, Business, Tutor and Property detail pages; image-led cover; mobile-first cover → summary → CTA → facts → sections order with a sticky desktop summary/action panel; sections and facts built from real fields only (no fake ratings/reviews/trust signals); a captioned hero fallback for missing images (`size="hero"` on `PlaceholderImage`/`CardImage`); 44px CTAs and a 44×44 detail Save button; a long-token overflow bug fixed. News received only the shared hero treatment. Also a global accessibility fix: the light-mode primary, brand-accent and destructive tokens were darkened within their existing color families to reach ≥4.5:1 text contrast (5.48 / 5.18 / 5.45:1), with a darker default-Button hover — documented in `DESIGN_SYSTEM.md` §4/§15; dark-mode tokens unchanged.
- Deliberately not implemented: ratings/reviews/maps/verification, related-content recommendations, image galleries/carousels (only one image per item exists), real upload/storage, new demo photography (Business Directory photo *coverage* is still uneven — only its fallback presentation improved), the unconsumed `Card` variants, migrating `NewsCard`/`CategoryCard`/`ListingSummaryCard`, any search/workspace/admin/dark-mode work.
- Dependencies: Visual Phase V1 (the `Card` primitive), Visual Phase V2. No new dependency.
- Verification: `npx tsc -b --force` and `npm run build` pass; lint remains at the established 8-warning baseline; fresh browser console 0 errors / 0 warnings; verified at 375/430/820/1440px (cover, summary column, sticky behavior, CTA size/alignment, overflow, long-content and image-shape resilience), plus keyboard order/focus, Save, CTA behavior, Back and the login-resume flow; button states (default/hover/focus/disabled/outline/destructive) re-measured after the contrast change; reviewed via `review-phase` — final verdict READY FOR COMMIT.
- Known follow-ups: warning/success/info status-badge contrast (about 2.71/2.79/4.19:1) and a dedicated focus-indicator contrast review; Featured badge markup duplicated between cards and `FeaturedBadge`; real-device testing pending; demo imagery will be replaced by real client/user media.

## Visual Phase V4 — Resident + Professional Workspace Polish
**STATUS: COMPLETE** (commit `e51d5e9`)

- Objective: apply the shared `Card` primitive (`workspace` variant) and typography/spacing polish to Resident and Professional Workspace surfaces per `docs/design/DESIGN_SYSTEM.md` §12/§23.
- Delivered: Resident Overview with real Saved / Active Requests / All Requests metrics plus recent requests and saved items; Saved grouped by domain (the `{kind,id,savedAt}` model preserved); My Requests grouped into active and completed/cancelled with status-derived progress (list bar, detail tracker); Professional Overview with real derived metric tiles; Listings (quota visualization respecting pending+approved counting) and Leads (`REQUEST_TRANSITIONS` preserved exactly) on workspace surfaces; honest, entitlement-gated Analytics; polished Upgrade/Profile with no billing or fabricated fields; shared `WorkspaceTabs` nav. New shared primitives: `StatusBadge`, `WorkspaceTabs`, `MetricTile`, `WorkspaceSection`, `WorkspaceEmpty`, `SelectableCard`, `RequestProgress`, `RequestMeta`. Accessibility: new `--success-text`/`--warning-text`/`--info-text` tokens lift status-badge text contrast to ≥5.45:1; statuses always carry text + icon; stronger focus ring on V4 surfaces; 44px workspace nav and mobile tap targets.
- Deliberately not implemented: fake ETAs/costs/history, revenue/views/conversion analytics, notifications, messaging, reviews/ratings, billing/checkout, profession-specific modules, any change to search, detail pages, Admin, auth, entitlements, the listing status machine, routes, persistence or dark mode.
- Dependencies: Visual Phase V1 (the `Card` primitive); Phase 9C–9E (the surfaces polished). No new dependency.
- Verification: `npx tsc -b --force` and `npm run build` pass; lint remains at the established 8-warning baseline; no test suite; fresh browser console 0 errors / 0 warnings; verified at 375/430/820/1440px and across the live Resident/Professional flows (including Free quota, Leads transitions, Analytics lock, plan switch and logout reset); bundle ≈ +1.1%; reviewed via `review-phase` — READY FOR COMMIT.
- Known follow-ups: Admin/some consumer badges still on the older status presentation; global focus-ring treatment for the final accessibility review; shared `EmptyState` h1→h3 skip; 28px consumer-card WhatsApp/Request targets on Saved; no stored cancellation history.

## Visual Phase V5 — Admin Refinement
**STATUS: COMPLETE** (commit `c26bda2`)

- Objective: bring Admin to production-quality visual and accessibility standards per `docs/design/DESIGN_SYSTEM.md` §13/§23 while preserving its dark-header, dense, utilitarian identity.
- Delivered: dashboard with real status-badge counts (Pending/Approved/Rejected/Archived listings, Published/Draft content); a shared dense `AdminRow` for the moderation queue and content list, with filter counts and thumbnails only where real media exists; a review dialog reorganized around the moderation decision with a sticky mobile action region and improved rejection-reason UX; accessible Draft/Published status via the shared `StatusBadge` (old low-contrast Admin statuses migrated, all ≥5.45:1); grouped, 44px-target content form; labeled header icons; Admin-local strong focus ring; dialog focus that starts intentionally and returns to the opening Review control.
- Deliberately not implemented: bulk or AI moderation, analytics/charts, audit logs, notifications, reviewer assignment, role changes, any change to approve/reject/publishing logic, the auth model, routes, backend code, or non-Admin surfaces.
- Dependencies: Visual Phase V4 (`StatusBadge`, status tokens, workspace primitives). No new dependency.
- Verification: `npx tsc -b --force` and `npm run build` pass; lint remains at the established 8-warning baseline; no test suite; fresh browser console 0 errors / 0 warnings; verified at 375/430/820/1440px and across the live Admin flows; bundle ≈ +0.45%; reviewed via `review-phase` — READY FOR COMMIT.
- Known follow-ups: global focus ring; ~27–28px consumer-card WhatsApp/Request targets; `EmptyState` h1→h3 skip; no Admin logout control; Approve/Reject still offered on some non-pending listings (valid state transitions must be decided before backend enforcement); the Admin resident preview still uses the consumer card.

## Visual Phase V6 — Final Responsive, Accessibility & Interaction Polish
**STATUS: COMPLETE** (commit `683303b`)

- Objective: close the remaining accessibility and responsive debt across all surfaces, per `docs/design/DESIGN_SYSTEM.md` §19/§20/§23.
- Delivered: one consistent focus system (accessible green `--ring`, solid rings, baseline outline, no double indicators; Search pill ring follows input focus); effective ~44px touch targets via shared `Button`/`Toggle` hit areas, 44px touch inputs and link/chip fixes, with the compact Search pill redirecting padding/icon presses to the input; `EmptyState` explicit heading level with one h1 and no heading skips per page; shared dialog focus return, viewport-constrained scrolling dialogs and long-token wrapping; an accessible success-dialog title; the last semantic status color uses migrated; Admin logout through the existing Admin auth context; a 320/375/430/820/1024/1440px responsive sweep with a content stress test.
- Deliberately not implemented: business-logic changes (including Admin Approve/Reject on non-pending listings), PWA, route-level code splitting, backend work, dark mode, new animation.
- Dependencies: Visual Phases V1–V5. No new dependency, no new files (47 modified).
- Verification: `npx tsc -b --force` and `npm run build` pass; lint remains at the established 8-warning baseline; no test suite; fresh browser console 0 errors / 0 warnings; Search V2.1 behavior and the full Resident/Professional/Admin flows re-verified; bundle ≈ +0.2%; reviewed via `review-phase` — READY FOR COMMIT.
- Known follow-ups: desktop Footer/Back-link density; real-device/iOS testing; Admin resident preview reuses the consumer card; Admin non-pending transition rules need a product/backend decision; the large single JS bundle (route-level code splitting).

### Visual Refresh sequence — complete
V1 Shared Card Foundation → V2 Consumer Discovery → V2.1 Predictive Search → V3 Detail Pages + Imagery → V4 Resident + Professional Workspace → V5 Admin Refinement → V6 Final Responsive, Accessibility & Interaction Polish.

## Food & Dining Directory Expansion
**STATUS: COMPLETE** (FD1–FD5 complete; FD5 commit `431b954`)

- Source of truth: `docs/product/FOOD_DINING.md` (architecture frozen; phases FD1–FD5, one commit each).
- Objective: add Food & Dining as a bounded frontend/product vertical expansion, reusing the existing Business Directory, search, listing-onboarding and Admin moderation patterns rather than introducing a new architecture.
- Out of scope: cart, online ordering, delivery logistics, payments, reviews/ratings, backend work.
- Dependencies: Visual Phases V1–V6; Phase 9B (search), Phase 9D (Professional Workspace) and the Admin moderation flow.

### FD1 — Domain / Data / Search Foundation
**STATUS: COMPLETE** (commit `120720f`)

- Delivered: explicit `Business.vertical` (`general | food`) with an optional `FoodProfile`; canonical config-backed Food categories and service options (`src/config/food.ts`), with the primary category driving `Business.category`; 10 demo Food businesses including the migrated Capital Bakers; Food remaining `SearchResultKind` `business`; `vertical` / `foodCategory` / `service` Search filters with validated URL state and filter controls; Food category labels and menu-highlight names searchable; Food predictive suggestions that resolve to actual results; the general Directory scoped to general businesses.
- Verification: `npx tsc -b --force` and `npm run build` pass; lint at the established 8-warning baseline; fresh Search console clean; Search V2.1 behavior, Saved, Professional and Admin compatibility verified; no dependency added.

### FD2 — Food Discovery
**STATUS: COMPLETE** (commit `1af5cea`)

- Delivered: the `/food` landing page (scoped Food search entry, config-driven category discovery and service-option shortcuts, a neutral Food business preview using `BusinessCard`, no fake Featured section); every Food path delegates to the existing Search (`type=business&vertical=food…`); General Directory tiles now scope with `vertical=general` so Food cannot leak into General Directory searches; Home, Directory, desktop-navigation and footer entry points; the five-item mobile bottom nav is unchanged.
- Verification: `npx tsc -b --force` and `npm run build` pass; lint at the 8-warning baseline; fresh console clean; Search V2.1, Saved and responsive (320–1440) checks passed; no dependency added.

### FD3 — Food Detail Experience
**STATUS: COMPLETE** (commit `dd28411`)

- Delivered: conditional Food sections inside the existing `BusinessProfilePage` (`/businesses/:id` stays the only Food detail route; no `FoodDetailPage`, no `/food/:id`); a Food & Dining identity badge with the primary category as subtitle and other categories as "Also serves"; service options with an explicit delivery-by-the-business clarification (B-17 Portal is not the delivery provider); a display-only hours note; informational menu highlights; an optional menu image; sections omitted when data is absent. `BusinessCard`, Saved storage, Search and General Business details are unchanged.
- Verification: `npx tsc -b --force` and `npm run build` pass (JS ≈ 871 KB); lint at the 8-warning baseline; fresh console clean; responsive (320–1440) and accessibility checks passed; no dependency added.

### FD4 — Listing / Professional / Admin Integration
**STATUS: COMPLETE** (commit `3d6ba96`)

- Delivered: a Business type choice (General Business / Food & Dining) in onboarding, with Food fields only for Food (`FoodListingFields`: 1–3 canonical categories with the first as primary, at least one service option — a frozen requirement, optional hours note, up to 8 menu highlights, optional menu image); Food-safe `buildBusiness` and validation; `Business.category` derived from the primary Food category; edit prefill and `FoodProfile` preserved through create / pending / reject / edit / resubmit / approve / archive; the existing Professional Workspace labels Food as "Food & Dining"; the existing Admin queue and review panel show Food identity and metadata; approved Food appears in Search, the FD3 detail sections and Saved (`kind: "business"`); the menu-price caption is neutral for demo and merchant data. No fourth listing kind, no new store, no quota or moderation change.
- Verification: `npx tsc -b --force` and `npm run build` pass (JS ≈ 888 KB); lint at the 8-warning baseline; fresh console clean; General Business regression clean; responsive (320–1440) and keyboard-focus checks passed; no dependency added.
- Known limitations: images are browser-local; Food → General discards Food data (an inline warning was added in FD5); Food cards / Saved remain generic; no backend persistence.

### FD5 — QA / Accessibility / Docs
**STATUS: COMPLETE** (commit `431b954`)

- Delivered: final end-to-end QA of the vertical — Food discovery, Search V2.1, Food detail, the create / edit / reject / resubmit / approve / archive lifecycle, Professional quota, Admin moderation, Saved, General Business regression, long / missing / empty Food data, responsive 320–1440 and accessibility; one fix (an inline warning when a Food listing is switched to General); the three Food docs synchronized (`docs/product/FOOD_DINING.md` is the final frontend source of truth).
- Verification: `npx tsc -b --force` and `npm run build` pass (JS ≈ 888 KB); lint at the 8-warning baseline; fresh console clean; no dependency added; no automated test suite.
- Result: the Food & Dining frontend expansion is complete. Reserved future work (backend persistence, real media storage, premium merchant tools, ordering / commission / payments, delivery, sharing / deep links, PWA / native packaging, personalization / history) is NOT part of the Food phases and belongs to the later roadmap items below.

### Planned sequence after Food & Dining
1. ~~Phase 9H — route-level code splitting / performance~~ — **COMPLETE** (commit `c2871f7`)
2. ~~Phase 9G — PWA / installability~~ — **COMPLETE** (commit `5c3e6d6`)
3. ~~Phase 9J — SEO, accessibility tooling and final frontend QA~~ — **COMPLETE** (commit `50e39b9`)
4. ~~Phase 9L — frontend cleanup & technical debt closeout~~ — **COMPLETE** (commit `5ed1799`)
5. ~~Phase 9M — Automated Testing Foundation (Playwright + MCP QA, including the Search UX review)~~ — **COMPLETE** (commit `d586f45`)
6. Frontend freeze
7. ~~Phase 10A — Backend Architecture & Contract Freeze~~ — **COMPLETE** (commit `e60a0b6`)
8. Phases 10B–13 — backend implementation (sequencing below)

Phases 9F (Admin Production UX) and 9I (Notifications + Trust/Reviews UI) remain valid Production V1 items below; their sequencing relative to the list above is to be confirmed by a product decision before the frontend freeze. Only 9H now runs before 9G.

## Phase 9F — Admin Production UX

- Objective: close the most visible Production V1 admin gaps.
- Major scope: user list/detail (against mock users), verification-state UI, sponsored/ad CRUD screen, moderation-history view.
- Out of scope: real RBAC enforcement, real audit persistence (backend-dependent).
- Dependencies: none new.
- Completion/verification: screens exist and function against mock data; existing moderation behavior unchanged.

## Phase 9G — Mobile/PWA
**STATUS: COMPLETE** (commit `5c3e6d6`)

- Objective: make the app installable and offline-tolerant for static assets.
- Delivered: web app manifest; icon set built from the existing brand mark (192 / 512 / maskable / Apple touch) and a brand favicon; a dependency-free service worker emitted at build (app-shell precache only, lazy chunks cached on use, network-first navigation with a shell fallback, one cache per build, no data caching); a quiet install strip (native Install button on Chromium, Share → Add to Home Screen guidance on iOS, hidden when standalone / dismissed — 30-day local dismissal); an update prompt (user-triggered, single reload) and an offline notice / "You're offline" route state; an error boundary in `RouteOutlet`; a shared offline guard (`useRequireOnline`) so state-changing actions on business data fail closed with an error toast while offline. No dependency added (`vite-plugin-pwa` not used — see DECISIONS.md).
- Result: installable per Chrome's own checks (no manifest or installability errors); Home initial JS +≈ 8 kB (+1.3%) vs 9H, Phase 9H splitting preserved (lazy chunks are not precached); direct URLs, auth redirects and the 404 page work under the worker; console clean.
- Verification: `npx tsc -b --force` and `npm run build` pass; lint at the 8-warning baseline; verified on the production build in headless Chrome over CDP (the in-app browser pane cannot register service workers); real Android / iOS devices, Safari and Firefox were not tested.
- Not done (deliberately / deferred): per-route `<title>` / meta (done in Phase 9J); push notifications, Background Sync and offline mutation queues (need a backend); Capacitor / store packaging; sharing / deep links.

## Phase 9H — Performance & Route Splitting
**STATUS: COMPLETE** (commit `c2871f7`)

- Objective: reduce initial bundle size.
- Delivered: `router.tsx` converted to `React.lazy` page imports (Home, the three layout shells and the tiny ComingSoon / NotFound stubs stay eager); a keyed `Suspense` boundary (`RouteOutlet`) and a shared accessible `RouteFallback` inside each layout; no URL, guard, redirect, auth, Search or listing-lifecycle change; no dependency; no `manualChunks`.
- Result: initial Home JS ≈ 888 kB / 265 kB gzip → ≈ 609 kB / ≈ 195 kB gzip (−31% / −26%); the >500 kB chunk warning is gone (largest chunk 342 kB); Professional and Admin code no longer load on Home.
- Verification: `npx tsc -b --force` and `npm run build` pass; lint at the 8-warning baseline; direct-URL / refresh, Search V2.1, listing, Admin and responsive regressions clean; console clean.
- Remaining: `motion` (≈255 kB) is still on the initial path; many tiny shared chunks; no prefetching or bundle budget (all deliberately out of this phase).

## Phase 9I — Notifications + Trust/Reviews UI

- Objective: add a notification center UI shell.
- Major scope: bell icon + notification list populated from mock/local events (e.g., "listing approved").
- Out of scope: real push delivery, real reviews/ratings (still explicitly prohibited per product principles unless a real verification process exists).
- Dependencies: Phase 9C (requests) and Phase 9F/9D (approvals) for events to notify about.
- Completion/verification: shell renders and reflects mock events; no fabricated trust signals introduced.

## Phase 9J — Accessibility + SEO + Cleanup + Final Frontend QA
**STATUS: COMPLETE** (commit `50e39b9`)

- Objective: close remaining polish items before backend work begins.
- Delivered: one dependency-free SEO mechanism (central config + route table + entity descriptors + a single head writer) giving every route a real title; descriptions, canonical, Open Graph and Twitter tags for public routes; an index / noindex strategy (public discovery routes indexable; account, Professional, Admin, utility and 404 `noindex, nofollow`; dynamic `/search` `noindex, follow` with a stable canonical); `robots.txt`; a build-time sitemap emitted only when `VITE_SITE_URL` is configured (stable top-level routes only, no invented dates); structured data deliberately skipped (no real entity data); a `VITE_SITE_URL` seam and a `VITE_SITE_NOINDEX` staging switch (`.env.example`); accessibility fixes — a skip-to-main-content link in every layout, a proper h1 on the 404, and decorative card images so names are not announced twice; plus the final audits (accessibility tree + DOM + contrast scan + keyboard / dialog / form tests over 31 routes / states, 74-link navigation audit, copy audit, 34 surfaces × 6 widths responsive matrix, PWA and performance regression).
- Result: no accessibility blockers; Home initial JS +1.0% vs 9H (≈ 623 kB raw / 198 kB gzip), no >500 kB chunk; Phase 9G and 9H behavior preserved; no dependency added; console clean.
- Not run: Lighthouse, axe-core and screen-reader / real-device testing (none installed or available; nothing downloaded) — recorded in CURRENT_STATE.md.
- Not part of this phase's brief (closed in Phase 9L): the unlinked `/services/home-construction` Coming-Soon stub route, the orphaned demo images, the `shadcn` dependency question.
- Out of scope / deferred: anything requiring a backend — server-rendered or pre-rendered page metadata and link previews, a per-entity sitemap, structured data from real data, a real production URL.
- Frontend freeze verdict: the frontend is ready to be treated as the baseline for backend integration.

## Phase 9L — Frontend Cleanup & Technical Debt Closeout
**STATUS: COMPLETE** (Phase 9L commit: pending)

- Objective: close the remaining known frontend debt before automated testing and backend integration — cleanup only.
- Delivered: removed the obsolete, unreferenced `/services/home-construction` stub route (router, route constant, SEO entry); removed 19 proven-unreferenced demo photos (≈ 47 MB; `public/images` 51 MB → 3.9 MB) and two dead Phase 1 hooks (`useMediaQuery`, `useReducedMotion`); audited `shadcn` and kept it (`src/index.css` imports `shadcn/tailwind.css`, which the Dialog / Sheet / ToggleGroup state variants need — build-time only); confirmed no `console.*` / `debugger` / TODO leftovers; ran `npm outdated` for information only.
- Result: no valid route removed; no product behavior, dependency (`package.json` / lockfile unchanged), Search, PWA, SEO or performance change; `tsc` / build clean, lint at the 8-warning baseline; PWA and SEO regression suites and a smoke test re-verified; console clean.
- Search UX refinement is intentionally deferred to Phase 9M.

## Phase 9M — Automated Testing Foundation
**STATUS: COMPLETE** (commit `d586f45`)

- Objective: an automated test foundation over the frozen frontend baseline, plus the deferred Search UX review.
- Delivered: Vitest + jsdom + RTL unit/component suite (168 tests); Playwright E2E (68 tests; desktop, mobile, PWA projects) against the production build on `127.0.0.1:4173`; GitHub Actions frontend CI; `docs/development/TESTING.md`; Playwright MCP exploratory Search review (`SEARCH_UX_FINDINGS.md`).
- Bug found and fixed: nested interactive controls (Save inside Preview) in Search result cards — minimal semantic fix, regression-tested.
- Out of scope / unchanged: backend, new product features, Search redesign/ranking, personalization, sharing, native apps, payments.
- Known gaps (see `TESTING.md`): Chromium only, no axe/Lighthouse, no real-device or visual-regression testing.

---

## Phase 10A — Backend Architecture & Contract Freeze
**STATUS: COMPLETE** (commit `e60a0b6`)

- Objective: design and freeze the backend architecture and API/data contracts against the **actual** frontend source, before any backend code.
- Delivered: `docs/backend/` — `BACKEND_ARCHITECTURE.md`, `DATA_MODEL.md`, `API_CONTRACT.md`, `AUTH_RBAC.md`, `MEDIA_STORAGE.md`, `DEPLOYMENT.md`.
- Out of scope / unchanged: any code, dependency, database, migration, Docker file, auth, API or frontend change.

## Backend phase sequence (approved in the Phase 10A review)

This re-sequences the earlier placeholders (old 10 "Backend Architecture", 11 "PostgreSQL/Data Layer", 12 "Frontend/API Integration", 13 "Security/Auth/RBAC/Storage/Deployment"): architecture is now 10A, the data layer is 10C, authentication is pulled out of 13 into its own Phase 11, and media/deployment form Phase 13.

## Phase 10B — FastAPI Project Foundation
**STATUS: COMPLETE** (commit `4d73c59`)

- Delivered: `backend/` Python project (`pyproject.toml`), app factory, typed settings, `GET /api/v1/health`, request-ID middleware, structured JSON logging, the `{data}` / `{error}` envelopes (validation, 404/405 and unhandled-error normalization), explicit-origin CORS, OpenAPI/docs (not published in production), pytest suite (75 tests, no database), ruff + mypy (strict), and `.github/workflows/backend-ci.yml`.
- Moved out of 10B (scope decision, see `DECISIONS.md`): the API Dockerfile and Compose PostgreSQL now belong to 10C with the data layer they serve; the readiness check (`/health/ready`) arrives with the database.
- **No domain tables, no database, no auth, no frontend change.**

## Phase 10C — PostgreSQL / SQLAlchemy / Alembic Data Layer Foundation
**STATUS: COMPLETE** (commit `d0c02dd`)

- Delivered: 15-table PostgreSQL schema (`docs/backend/DATA_MODEL.md`) with Alembic baseline `0001`, database-level integrity (Food↔business-vertical composite FK, menu/category limits, Saved uniqueness, history consistency, …), typed SQLAlchemy 2 models, session/transaction infrastructure, taxonomy + listing repositories, `ListingCreationService` (all-or-nothing multi-table create), reference-taxonomy seed (39 categories) and dev fixtures (fixed UUIDv5 ids), `GET /api/v1/health/ready`, API Dockerfile + Compose PostgreSQL, strict test-database safety, 291 tests (166 on real PostgreSQL), and PostgreSQL + migration/drift/seed checks in backend CI.
- Deferred (per DATA_MODEL.md): `search_document` / `pg_trgm` (delivered in 10D), `service_requests`, `media_assets`, content-version history.
- **No product API, no auth, no frontend change.**

## Phase 10D — Read APIs
**STATUS: COMPLETE** (commit `2e73ebf`)

- Delivered: `GET /categories`, `/search`, `/search/suggestions`, `/listings/{id}`, `/news`, `/news/{id}` on real PostgreSQL; migration `0002` (`pg_trgm`, maintained `listings.search_document`, GIN trigram + partial area indexes); `SearchIndexer` + `python -m app.db.search_index`; deterministic title-first ranking; kind-aware filters with the frontend's semantics; ranked suggestions; public visibility (approved/published only, one shared `404`); extended fixtures; 539 tests; parity notes in `docs/backend/READ_API_PARITY.md`.
- **No writes, no auth, no frontend change.** The two LOW Search UX findings remain deferred.

## Phase 11 — Authentication, OAuth & RBAC
Split into three phases (split approved in the 11A review) because the security surface genuinely differs (design → credentials/sessions → third-party OAuth). The full frozen design is `docs/backend/AUTH_RBAC.md`.

### Phase 11A — Authentication Security & Contract Freeze
**STATUS: COMPLETE** (docs only; commit `3c10c1a`)
- Delivered: server-side session cookie strategy (PostgreSQL, hashed tokens, multi-device, no Redis, no JWT), cookie and CSRF contract, session lifetimes, Argon2id password policy, verification/reset token design, Google OAuth + account-linking rules, Facebook/Apple compatibility, role model (Resident / Professional capability / Admin grant), authorization dependencies, ownership and 401/403/404 policy, account status, rate-limit seam, audit events, logging redaction, retention, planned schema (`0003`/`0004`), exact endpoints and error codes, test plan, security matrix and threat review.
- **No code, no migration, no dependency, no frontend change.**

### Phase 11B — Email/Password Authentication + Sessions
**STATUS: COMPLETE** (commit `ea57a11`). Delivered: migration `0003`; Argon2id + `email-validator`; sessions, cookie, CSRF/Origin enforcement, CORS credentials switch; register / login / logout / logout-all / me / verify-email / resend-verification / forgot- / reset- / change-password; authorization dependencies + permission map; email seam (console/memory); PostgreSQL identity-keyed rate limiter; `auth_events`; `app.cli.admin` and `app.cli.auth_maintenance`; tests per `AUTH_RBAC.md` §17. **No frontend change.**

### Phase 11C — Google OAuth + Account Linking + Authentication Hardening
**STATUS: COMPLETE** (commit `30736bf`). Delivered: migration `0004` (`oauth_flows`, `UNIQUE(user_id, provider)`); Google provider behind an `OAuthProvider` interface (`PyJWT` + `httpx`, no SDK) with a development/test-only fake; `POST /auth/oauth/google/start`, `GET …/callback`, `DELETE /auth/oauth/google`; PKCE + `state` + `nonce` + a browser-binding flow cookie, single-use flows; linking cases A, B, C1–C4, D and the narrow unverified-account claim (C2); redirect-safety validator; sessions/CSRF unchanged; maintenance purge of old flows; unit, HTTP, database and concurrency tests (no network). Not done: a real-Google smoke test (manual, `DEPLOYMENT.md` §10). **No frontend change.**

**NEXT: Phase 12D** (Phase 12C is complete, commit pending).

## Phase 12 — Write APIs, Location/Map & Frontend/API Integration

**Phase 12A — Architecture & Location/Map Freeze: COMPLETE** (docs only; commit `d29b665`). Frozen in `docs/backend/LOCATION_MAP.md` (location + maps), `docs/backend/API_CONTRACT.md` §10 (write contract), `docs/backend/AUTH_RBAC.md` §22 (guards + frontend auth), `docs/backend/DATA_MODEL.md` §16 (migrations `0005`/`0006`). Phase 11 authentication behaviour is unchanged. **Map/Location is a first-class Phase 12 requirement**: Phase 12 is not complete until the definition of done in `LOCATION_MAP.md` §17 holds.

Sequence (re-derived from the code's dependencies; each slice is independently verifiable, ships its tests and docs, and is one commit):

| Slice | Scope | Depends on | Key verification |
|---|---|---|---|
| **12A** | This freeze | — | docs only; diff contains no code, migration or dependency |
| **12B** | **COMPLETE** (commit `10abbfd`). **Database + location foundation (backend):** migration `0005`; `Listing` location columns (private ones `deferred`), generated public coordinates, CHECKs; public/owner/admin location schemas and the pure serializer; additive `location` on `/search` cards and `/listings/{id}`; `search_document` (block; address/landmark only for exact); explicit synthetic fixture locations (fixture-loader step, not the migration); a purely additive migration that leaves existing rows in the documented legacy state. **No write endpoint, no geofence.** | 11 | migration up / down / re-up / drift **including pre-`0005` listings of every kind and status** (unchanged `area` / status / `search_document`, area-only, no coordinates); constraint tests; generated-column tests (`round(exact, 2)`); the full privacy matrix on every read surface; `raiseload` and compiled-SQL guards; unchanged N+1 statement counts; `search_index check` |
| **12C** | **COMPLETE** (Phase 12C commit: pending; as built in `AUTH_RBAC.md` §23; Connect/Disconnect Google and change-password UI deferred until an account-security screen exists). **Frontend auth foundation:** `apiClient` (credentials, in-memory CSRF, one retry on `csrf_failed`), real `AuthProvider` (`loading → anonymous \| authenticated`), login / register / logout, Google start + `/login?error=` + Connect / Disconnect, `/verify-email` and `/reset-password` (fragment handling), status-aware guards, removal of the demo and separate admin auth, per-user client state cleanup. | 11 (backend ready) | Vitest with a mocked `fetch` (state machine, CSRF retry, fragment removal, error mapping, no storage writes); manual smoke against the local API; E2E deferred to 12I |
| **12D** | **Listing + professional write API** (also introduces the `LOCALITIES` setting and the new error codes `listing_conflict` / `professional_profile_required`): `PUT /users/me/professional-profile`, owner reads, `POST/PATCH /listings`, `archive`; lifecycle, revision guard, quota lock, Food and category rules, location validation (per-kind requiredness, `LOCALITIES`, range-only coordinates), the **pure-narrowing rule** (§7.4 matrix), `search_document` refresh, history, rate limits. | 12B | the §22.6 matrix for these endpoints; lifecycle table cell by cell; concurrency tests on committed rows; location validation + privacy on owner surfaces |
| **12E** | **Admin moderation + taxonomy API:** admin queue (counts), detail with exact location, `approve` / `reject`, category create / patch / reorder with search refresh; admin-freshness behaviour. | 12D | stale-revision `409`, approved → rejected takedown, double-approve, category misuse, stale admin session |
| **12F** | **Saved + requests API:** migration `0006`; `/saved`; `/requests`, leads, request actions with history; rate limits. **Gate: the product owner must resolve O-3 (contact channel) before this slice's request implementation is finalised.** | 12D (needs approved listings), 12E for end-to-end approvals | idempotency, IDOR, guarded transitions, concurrency, visibility rules |
| **12G** | **Frontend data layer + read integration + map display:** API-backed search / suggestions / detail / categories / news behind the existing `services/search.ts` signatures; `MapEngine` + `MapView` + `DirectionsButton` + `LocationSection` on Business, Food, Property, Tutor and Provider pages; lazy Leaflet chunk; tile / bounds configuration; demo data retained only as test fixtures. **First slice that adds a dependency (`leaflet`) — needs explicit approval at that point.** | 12B, 12C | Vitest with a fake engine for all three modes; URL-generation tests; bundle check (initial path unchanged); a11y; Playwright specs with tile hosts stubbed |
| **12H** | **Frontend write integration:** professional onboarding step; Business / Food / Property forms with `LocationPicker`; edit / resubmit / archive with the conflict dialog; owner lists with real status; admin moderation and category screens; Saved; service requests and leads; retire the Zustand mock mutations; decide the Upgrade page (no billing). | 12C–12G | component tests per form; picker keyboard path; conflict dialog; mapped `422`s |
| **12I** | **Full-stack closeout:** Playwright against the real API and a seeded test database (journeys, privacy E2E for all three modes, mobile map/picker checks), CI wiring, docs sync, definition-of-done review. | all | CI green with no live tile / geocoding / maps dependency |

Any slice whose diff outgrows a reviewable size (≈ 25 files or an unrelated concern) is split at implementation time rather than merged large. Phase 13 (media + production deployment) is unchanged.

## Phase 13 — Media Storage & Production Deployment
S3-compatible media upload, hosting, backups, monitoring, SPA-fallback hosting config. Not started.
