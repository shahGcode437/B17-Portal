# B-17 Portal — Current Development State

## Last Updated

2026-10-17

## Current Branch

master

## Current Verified Commit

4e92833 Visual V2.1: add contextual predictive search
d993992 Visual V3: refresh detail pages and imagery
e51d5e9 Visual V4: polish resident and professional workspaces
c26bda2 Visual V5: refine admin experience
683303b Visual V6: finalize responsive accessibility and interaction polish
d8ee414 docs: freeze Food and Dining architecture
120720f FD1: add Food and Dining domain search foundation
1af5cea FD2: add Food and Dining discovery experience
dd28411 FD3: enrich Food and Dining business details
3d6ba96 FD4: integrate Food listings with professional and admin flows
431b954 FD5: complete Food and Dining frontend QA
c2871f7 Phase 9H: add route-level code splitting
5c3e6d6 Phase 9G: add PWA installability and offline safety
50e39b9 Phase 9J: complete SEO accessibility and frontend QA
5ed1799 Phase 9L: clean frontend technical debt
d586f45 Phase 9M: add automated frontend testing foundation
e60a0b6 Phase 10A: define backend architecture and contracts
4d73c59 Phase 10B: add FastAPI project foundation
d0c02dd Phase 10C: add PostgreSQL data layer foundation
2e73ebf Phase 10D: add PostgreSQL-backed read APIs
3c10c1a Phase 11A: freeze authentication security architecture
ea57a11 Phase 11B: add secure email password authentication
Phase 11C commit: pending (implementation complete, not yet committed)

## Current Phase

Current Phase: Phase 11C — Google OAuth + Account Linking + Authentication Hardening: COMPLETE, commit pending approval. Phase 11B (email/password auth, `ea57a11`), Phase 11A (auth design freeze, `3c10c1a`), Phase 10D (read APIs, `2e73ebf`), Phase 10C (data layer, `d0c02dd`), Phase 10B (FastAPI foundation, `4d73c59`), Phase 10A (backend architecture, `e60a0b6`), Phase 9M (testing foundation, `d586f45`), Phase 9L (cleanup), Phase 9J (SEO / accessibility / final frontend QA), Phase 9G (PWA), Phase 9H (code splitting), the Food & Dining expansion (FD1–FD5) and the Visual Refresh (V1–V6) are complete and committed. Search UX refinement remains deferred; the Search review is in `SEARCH_UX_FINDINGS.md`.
Next Step: Phase 12 — Write APIs + frontend/API integration (see Next Step below).

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
- Visual/UI Refresh audit + `docs/design/DESIGN_SYSTEM.md` (single visual-design source of truth)
- Visual Phase V1 — Shared Card Primitive + Surface Foundation (see below)
- Visual Phase V2 — Consumer Discovery/Card Refresh (see below)
- Visual Phase V2.1 — Contextual Search + Predictive Suggestions (see below)
- Visual Phase V3 — Detail Pages + Imagery (see below)
- Visual Phase V4 — Resident + Professional Workspace Polish (see below)
- Visual Phase V5 — Admin Refinement (see below)
- Visual Phase V6 — Final Responsive, Accessibility & Interaction Polish (see below)
- Food & Dining FD1 — Domain / Data / Search Foundation (see below)
- Food & Dining FD2 — Discovery (see below)
- Food & Dining FD3 — Detail Experience (see below)
- Food & Dining FD4 — Listing / Professional / Admin Integration (see below)
- Food & Dining FD5 — Final QA / Accessibility / Documentation (see below)
- Phase 9H — Performance & Route-Level Code Splitting (see below)
- Phase 9G — PWA / Installability (see below)
- Phase 9J — SEO + Accessibility Tooling + Final Frontend QA (see below)
- Phase 9L — Frontend Cleanup & Technical Debt Closeout (see below)
- Phase 9M — Automated Testing Foundation (see below and `TESTING.md`)
- Phase 10A — Backend Architecture & Contract Freeze (see below and `docs/backend/`)
- Phase 10B — FastAPI Project Foundation (see below and `backend/`)
- Phase 10C — PostgreSQL / SQLAlchemy / Alembic Data Layer Foundation (see below and `docs/backend/DATA_MODEL.md` §14)
- Phase 10D — Backend Read APIs (see below, `docs/backend/API_CONTRACT.md` §6.1 and `docs/backend/READ_API_PARITY.md`)
- Phase 11A — Authentication Security & Contract Freeze (see below and `docs/backend/AUTH_RBAC.md`)
- Phase 11B — Email/Password Authentication + Sessions + CSRF + RBAC Foundation (see below and `docs/backend/AUTH_RBAC.md` §20)
- Phase 11C — Google OAuth + Account Linking + Authentication Hardening (see below and `docs/backend/AUTH_RBAC.md` §21)

Full history is in `git log`; this file summarizes outcomes, not the blow-by-blow.

## Current Architecture

- React 19 + TypeScript (strict) + Vite 8 SPA, no SSR.
- Three route trees under `createBrowserRouter`: `ConsumerLayout` (Header/Footer/MobileNav), `ProviderLayout` (now a full Professional Workspace shell — Overview/Listings/Leads/Profile nav, Phase 9D), `AdminLayout`. Route pages are lazy-loaded (Phase 9H): only the three layout shells, `HomePage` and the tiny `ComingSoonPage` / `NotFoundPage` stubs are statically imported; every other page is a `React.lazy` dynamic import, rendered inside a keyed `Suspense` boundary in each layout (`RouteOutlet`).
- `src/services/search.ts` is the single public read-data seam for all domain content (providers, businesses, tutors, properties, news, sponsored cards, plus category/subject/type tile enumeration, and — as of Visual V2.1 — `getSearchSuggestions` for predictive search). Components must not import `@/data/*` domain arrays directly — confirmed and enforced as of Phase 9A.
- Search/Explore state contract (Visual V2.1): URL = committed state (`q`/`type`/filters/sort); the input is a local draft of `q`; the suggestion list is transient local state. No global search store.
- Four Zustand stores: `listingsStore` (provider/business/property listing lifecycle: pending → approved/rejected, plus `archived` as of Phase 9D; `selectActiveListingsBySubmitter`/`isListingCountedTowardPlanLimit` added Phase 9E for the Free listing-limit check) and `newsStore` (draft/published) are in-memory only, reset on reload. `residentStore` (Phase 9C — saved items + request history; Phase 9D added `updateRequestStatus`) and `planStore` (Phase 9E — the mocked local Free/Premium plan) both persist to `localStorage` via Zustand's own `persist` middleware; both are cleared/reset on explicit resident Log Out (see Phase 9C/9E Results).
- Demo-only auth: `useAuth()`/`useAdminAuth()`, name-only sessions, no password, no backend. Already consumed only through their public hooks everywhere (verified in Phase 9A). `AuthProvider.logout()` also clears `residentStore` and resets `planStore` — see Phase 9C/9E Results.
- Free/Premium capability model (Phase 9E): `Plan → PlanEntitlements → Capability`, centralized in `types/entitlements.ts`/`config/plans.ts`, consumed only via `useCapability`/`usePlanEntitlements`/`<RequireCapability>` — never a scattered `plan === "premium"` check. Frontend-only UX gating, explicitly not a security boundary.
- Shared `Card` surface primitive (Visual Phase V1, `src/components/ui/card.tsx`) — presentation-only, variants `default`/`interactive`/`elevated`/`workspace`/`featured`; `ProviderCard`/`BusinessCard`/`TutorCard`/`PropertyCard` compose it instead of each owning its own surface classes. As of Visual Phase V2, `ProviderCard`/`BusinessCard` use the `featured` variant when the item's real `featured` seed field is `true`. `docs/design/DESIGN_SYSTEM.md` is the single visual-design source of truth going forward.
- Static seed data lives in `src/data/*.ts`, typed via `src/types/*.ts`.
- TypeScript strict mode enabled (Phase 9A) — zero errors, no `any`, no suppressions needed.
- PWA (Phase 9G): installable web app — manifest, icons, a small hand-written service worker and an install/update/offline UX (see Phase 9G Result). Not store-packaged.
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

## Visual Phase V1 Result

- Added a shared, presentation-only `Card` primitive (`src/components/ui/card.tsx`) per `docs/design/DESIGN_SYSTEM.md` §8 — variants: `default` / `interactive` / `elevated` / `workspace` / `featured`. `Card` never sets `role`/`tabIndex`/`onClick`/`onKeyDown`/`aria-label` itself; a consumer must still supply those explicitly to make a card clickable.
- `ProviderCard`, `BusinessCard`, `TutorCard`, `PropertyCard` migrated to compose `Card` (`variant="interactive"`), replacing an identical hand-duplicated wrapper class string that previously existed independently in all 4 files.
- `CardImage`/`PlaceholderImage` imagery seam untouched — each migrated card still owns its own image region, overlays (`SaveButton`, `Badge`), and CTA row exactly as before.
- Keyboard activation (Enter/Space), click navigation, Save/Favorite, badges, and CTA behavior all verified unchanged, live, across all 4 migrated cards.
- Existing motion system reused as-is — the shared `cardHover` preset now applies from inside `Card` for `interactive`/`featured` variants only, instead of being spread independently in each card component; no new motion concept introduced.
- No new visual tokens — every `Card` class references an existing token already in `src/index.css`.
- No dependency added (`package.json` unchanged).
- `npx tsc -b --force` and `npm run build` pass. Lint remains at the established 8-warning baseline (a transient 9th `only-export-components` warning from `card.tsx` exporting `cardVariants` was fixed by making `cardVariants` module-private before final review).
- Reviewed via `review-phase`: verdict READY FOR COMMIT.
- Known follow-ups, intentionally deferred: `CategoryCard` and `ListingSummaryCard` still hand-roll their own surface styling (not migrated — `CategoryCard` renders as a `Link` with `compact`/`emphasis` props that don't map onto the current variant set; `ListingSummaryCard` is non-interactive with different padding/layout); the `elevated`/`workspace`/`featured` `Card` variants are defined (per DESIGN_SYSTEM.md §8) but have no consumer yet in production UI.

## Visual Phase V2 Result

**Search/Discovery**: Search/Explore's control hierarchy now reads SEARCH → FILTER → ACTIVE CRITERIA → RESULT COUNT → RESULTS. Desktop filters are grouped inside a `Card`-surfaced panel; the content-type toggle and active filter chips get a clearer primary-tinted selected state (scoped to `FilterControls.tsx`/`SearchPage.tsx` only — the shared `toggle.tsx` primitive, also used by `UpgradePage`, was not touched); the result count moved to its own labeled line directly above the grid; the results grid density increased from 3 to 4 columns, matching Home's existing card density; `ResultCardSkeleton` now shares the same `Card` surface as the real cards instead of a parallel hand-rolled one.

**Search UX fix**: Home Hero's quick-search suggestions ("Try: Electrician," etc.) previously navigated to Search without ever syncing Hero's own controlled search input — a local-state desynchronization in `Hero.tsx`, not a `SearchPage`/URL-architecture problem. Fixed by having `runSearch` call `setQuery(value)` before navigating. `SearchPage`'s URL-as-source-of-truth architecture is unchanged. Verified: quick-suggestion click, manual typing, Enter submit, clear, hard reload directly on a filtered URL, browser Back/Forward, and mobile all behave correctly.

**Cards**: `ProviderCard`/`BusinessCard` now use the `featured` Card variant (defined but unconsumed since Visual V1) only when the real `provider.featured`/`business.featured` seed field is `true` — confirmed via `grep` that `Tutor`/`Property` have no `featured` field, so neither received a fabricated featured treatment. All 4 domain-card titles now use 2-line clamping for long-name resilience. Keyboard activation (Enter/Space), click navigation, Save/Favorite, and CTA behavior were all verified unchanged live.

**Directory/Services**: no changes — live verification showed both pages already have well-populated real category grids (7 and 11 categories respectively); the prior audit's "sparse" finding was a stale-render artifact of session tooling, not a real gap.

**Performance/quality**: no new dependency; bundle size increase negligible (+0.06% JS, confirmed via build output); `npx tsc -b --force` clean; `npm run build` succeeds; `npm run lint` remains at the established 8-warning baseline; no test suite exists to run; no auth/admin/professional-workspace/detail-page/backend architecture touched.

- Reviewed via `review-phase`: verdict READY FOR COMMIT.
- Known follow-ups, intentionally deferred: `NewsCard` still hand-rolls its own card surface; `CategoryCard` remains unmigrated to the `Card` primitive (intentional — it renders as a `Link` with `compact`/`emphasis` props, and adding `asChild` "merely because" was explicitly out of scope); the `elevated`/`workspace` `Card` variants remain unused in production UI; detail pages remain the largest visual-quality gap (one hero photo then plain text blocks) and are Visual V3's explicit focus; Business Directory image coverage (several categories still fall back to the generic placeholder) still needs improvement; tablet width (820px) was not freshly re-screenshotted during the final V2 review (unchanged grid-breakpoint classes already verified at that width in V1).

## Visual Phase V2.1 Result

**Search architecture**: the URL remains the committed source of truth (`q`, `type`, filters, sort — results read straight from it). The search input is a local *draft* of the URL's `q`; the suggestion list is transient local UI state. No new global search store and no backend dependency was added. The previous model mirrored local state *into* the URL through an effect; that was removed (see "same-mount URL fix" below).

**Predictive search**: a typed `SearchSuggestion` model (`{ id, label, secondaryLabel, type, value }`, no domain objects) and `getSearchSuggestions(query, type, limit)` in the `search.ts` data seam. Suggestions derive only from real, existing approved/published data (item names/titles, categorical fields, tags) — nothing invented; selecting any suggestion always yields at least one result in its own type. Ranking is deterministic: exact → starts-with → word-prefix → contains; de-duplicated per type and capped at 8; minimum 2 characters. Type-specific suggestions are supported (Services/Directory/Education/Property/News only suggest their own domain; All mixes domains). Area and furnishing are intentionally not suggested (each has an exact-match filter, and a substring query like "furnished" would also match "Unfurnished"). The engine sits behind `useSearchSuggestions`, which also owns the debounce, so a future `GET /api/v1/search/suggestions?q=&type=&limit=` call can replace the local implementation without rebuilding the SearchBar UI.

**Search UX**: mouse and keyboard suggestion selection; ArrowUp/ArrowDown/Enter/Escape; combobox/listbox semantics (`aria-expanded`/`aria-controls`/`aria-activedescendant`/`aria-selected`, plus a live region announcing the count; Tab closes the list with no keyboard trap). Manual typing is debounced into the URL (250ms); Enter commits immediately; selecting a suggestion updates query + type + URL + results in one write; clearing removes `q`; changing type preserves `q` (and drops filters/sort that belong to the old type); the placeholder is contextual per type. Reload and browser Back/Forward restore search state. The Home Hero quick-search sync fix from Visual V2 is preserved.

**Same-mount URL fix**: previously, an in-app navigation to `/search` while `SearchPage` was already mounted (Explore/header link, Back/Forward between two `/search` entries) was overwritten — the URL-sync effect re-ran with stale local state and wrote the old `q` back. Fixed by making the URL the only committed state: results read it directly, the input is a draft that is dropped on any PUSH/POP navigation (this page's own writes are always REPLACE) and a pending typing commit is cancelled, and all URL writes go through one `updateParams` helper that starts from the live browser URL. The skip-ref mechanism used earlier in the phase was removed. The draft reset uses React's documented render-phase "adjust state on change" pattern (guarded, loop-free, verified under StrictMode).

**Zero results**: contextual messaging (e.g. "No Education results for “Electrician”") with a primary action that clears the search while preserving the selected type, and a secondary action that broadens the same query to All of B-17. `EmptyState` gained optional secondary-action props (existing usages unchanged).

**Mobile**: the compact SearchBar input now uses 16px text below the `md` breakpoint (it measured 14px) to avoid mobile focus-zoom risk; desktop stays 14px. Verified 375/430px → 16px and 820px/desktop/1440px → 14px; autocomplete verified with no horizontal overflow and correct alignment at all tested widths; the Filters sheet still behaves correctly (the open suggestion list covers the Filters trigger on mobile, so it closes on an outside tap first).

**Hero**: the "Solar installer" quick-search chip became "Solar" — the previous static phrase matched nothing in the searchable data ("installation", never "installer"). "Solar" returns a real current result (Sunrise Solar Solutions). The other chips were not touched.

**Quality**: `npx tsc -b --force` clean; `npm run build` succeeds (JS ≈ 840 KB, +0.7% vs V2); lint remains at the established 8-warning baseline (an `exhaustive-deps` warning introduced mid-phase was fixed, not suppressed); no new dependency; fresh browser console 0 errors / 0 warnings; no test suite exists. Reviewed via `review-phase`: verdict READY FOR COMMIT.

**Known limitations**:
- Home quick-search chips are still curated static strings and could drift from the data in future.
- `updateParams` reads `window.location.search`, so it assumes browser history / `createBrowserRouter`; revisit if the router type changes.
- A future *external* REPLACE navigation into an already-mounted `SearchPage` would be treated as the page's own write (none exists today — every current `replace: true` targets another route).
- A theoretical few-millisecond window exists where an external PUSH and one of the page's own REPLACE writes land before a single React render; never observed.
- The real iOS on-screen keyboard has not been physically tested.
- No backend search service exists yet; local data powers the suggestions.

## Visual Phase V3 Result

**Detail pages**: the Provider, Business, Tutor and Property detail pages now share presentation-only detail primitives in `src/components/detail/` — `DetailLayout`, `DetailHero`, `DetailSummary`, `DetailSection`, `DetailFacts`, `DetailTagList` and `FeaturedBadge`. Each page decides what goes in each slot (domain differences are preserved; there is no giant universal component).

- **Layout/order**: mobile-first cover → summary → CTA → facts → sections, in DOM order; from `lg` the summary becomes a sticky side panel (pure CSS grid, no layout effects). The primary action is a 44px full-width button directly under the title (in the first screen at 375px), with a secondary outline button below it; facts sit after the actions.
- **Imagery**: image-led hero/cover (4:3 on mobile, 16:9 from `sm`; Property 16:10), loaded eagerly with high fetch priority; `object-cover` keeps portrait/panorama/tiny/very-large sources from changing the cover's size. A missing/failed image shows a deliberate captioned fallback ("No photo available", larger icon tile, same ratio) via a backward-compatible `size="hero"` option on `PlaceholderImage`/`CardImage` (card placeholders unchanged).
- **Real data only**: every fact, chip and section comes from existing fields (Featured only where `featured` is true; Property facts Type/Bedrooms/Furnishing/Area only when present; the price is shown as its original formatted string; sections are omitted when their data is absent). No fake reviews, ratings, verification, availability or trust signals; the honest demo disclaimer is retained. Existing actions are preserved (Back, Save, WhatsApp, Request Service with login-resume, Contact Business, Contact Agent, simulated toast messages).
- **Touch targets**: detail CTAs are 44px; the detail-page Save button was raised from 32×32 to 44×44 (card Save buttons are unchanged at 32×32).
- **Resilience**: a layout bug found by the long-content test was fixed — one unbroken long token had expanded the summary card to 1423px on mobile because the grid column was implicit; the explicit `minmax(0,1fr)` column keeps long titles/areas/descriptions contained (verified with a 185-character title, long area, 28 tags and long description at 375px). Desktop container widened to `max-w-6xl` (cover 768px at 1440px).
- **News**: received only the bounded shared hero treatment (`DetailHero`); its editorial layout and lack of marketplace CTAs are unchanged.

**Accessibility improvement (contrast)**: white text on the light-mode primary, brand-accent and destructive fills was below the 4.5:1 AA target (3.77, 3.56 and 4.14:1) — a system-wide pre-existing issue. The light-mode tokens were darkened within their existing color families (`--primary` `#059669` → `#047857`, `--brand-accent` `#ea580c` → `#c2410c`, `--destructive` `#dc2626` → `#b91c1c`), now 5.48 / 5.18 / 5.45:1 (destructive hover 4.59). The default Button hover now mixes a little foreground into primary (6.42:1; the former `primary/80` hover lightened the fill to 2.86:1). Every surface using these tokens inherits the change (default Buttons/Badges, the selected filter toggle, `text-primary` labels, the Featured badge, destructive buttons). Dark-mode tokens were not changed. Details are documented in `docs/design/DESIGN_SYSTEM.md` §4.

**Quality**: `npx tsc -b --force` clean; `npm run build` succeeds (JS ≈ 839 KB — slightly *smaller* than V2.1, since five pages' duplicated markup collapsed into shared components); lint remains at the established 8-warning baseline; no dependency added; fresh browser console 0 errors / 0 warnings; no test suite exists. Verified at 375/430/820/1440px on all four marketplace detail pages plus News, including the fallback-image cases in the seed data. Reviewed via `review-phase`: verdict READY FOR COMMIT.

**Known follow-ups**:
- The warning/success/info status-badge text (admin/workspace/resident surfaces) is still below 4.5:1 on its tinted fill (about 2.71, 2.79 and 4.19:1); the badges carry an icon and label, so they aren't color-only. Review in V4/V5.
- Focus-indicator contrast should receive a dedicated accessibility review (the focus ring is `ring-ring/50` at about 1.9:1 on white, with the solid ring-colored border as the stronger cue; `--ring` was intentionally not changed).
- Featured badge markup remains duplicated between `ProviderCard`/`BusinessCard` and the new `FeaturedBadge` (consolidating would touch V2 card files).
- Real-device testing remains pending (including the iOS on-screen keyboard from V2.1).
- Current demo imagery will later be replaced by real client/user media; the demo photos are ~1000px wide, so they render a little soft at the 768px cover on high-density screens. No gallery was built — only one image per item exists.

## Visual Phase V4 Result

Visual V4 — Resident + Professional Workspace Polish = **COMPLETE**. Presentation only: no business logic, status logic, entitlement semantics, routes or persistence changed.

**Resident**
- Overview shows real Saved / Active Requests / All Requests metrics (Active = not completed/cancelled); recent requests and recently saved items come from existing state only (saved references resolved through the public search boundary). No streaks, points, wallet or recommendations.
- Saved is grouped by domain (Services/Businesses/Tutors/Properties) while preserving the `{kind, id, savedAt}` reference model; each card keeps its own Save toggle (44×44 on this page).
- My Requests is grouped into Active and Completed & cancelled; cards show service, provider, dates, area and a progress bar. The request detail dialog includes a status-derived progress tracker. No fake ETA, cost or history data.

**Professional**
- Overview uses real derived metrics only (Active leads, Total/Pending/Approved/Rejected/Archived listings) as `MetricTile`s linking to their pages; recent listings/leads rows; empty states with real actions.
- Listings and Leads use workspace surfaces (`ListingSummaryCard` now on `Card` `workspace`). The Free-plan quota card visualizes active listings and respects the pending+approved counting rule. Leads are split Open vs Completed & cancelled and preserve `REQUEST_TRANSITIONS` exactly (the "Next action" hint reads from it).
- Analytics remains honest (derived status counts only) and entitlement-gated (Free sees the locked upsell). Upgrade and Profile are polished without billing or fabricated fields; the demo plan switch is unchanged.
- Professional and Resident navigation share `WorkspaceTabs`.

**Shared primitives introduced**: `StatusBadge` (`src/components/feedback/`), `WorkspaceTabs` (`src/components/navigation/`), and `MetricTile`, `WorkspaceSection`, `WorkspaceEmpty`, `SelectableCard`, `RequestProgress`, `RequestMeta` (`src/components/workspace/`), plus `src/features/resident/savedItems.ts` (saved-reference resolver). See `docs/design/DESIGN_SYSTEM.md` §12/§16. The `Card` `workspace` variant now has production consumers.

**Accessibility**
- Shared `StatusBadge`: statuses always include text + icon; new `--success-text`/`--warning-text`/`--info-text` tokens raise status-text contrast from 2.79 / 2.71 / 4.19:1 to 6.03 / 6.05 / 5.45:1 (all ≥ 5.45:1 as rendered; destructive 5.45:1, neutral 6.92:1).
- V4 workspace surfaces use the stronger solid focus ring (`ring-ring`, 3.77:1 on white).
- Workspace nav is 44px tall and fits at 375px; workspace tap targets (action buttons, dialog buttons, plan toggle, shell header link) raised for mobile; every Resident/Professional page has an `h1`.

**Quality**: no new dependency; `npx tsc -b --force` clean; `npm run build` succeeds (JS ≈ 848 KB, +~1.1% vs V3's ≈ 839 KB); lint remains at the established 8-warning baseline; no test suite exists; fresh browser console 0 errors / 0 warnings. Verified at 375/430/820/1440px (no horizontal overflow on any Resident/Professional route) and live: login, Saved add/unsave, request creation/history/detail, listing create/approve/reject/resubmit/archive, Free quota messaging, Leads transitions, Analytics lock/unlock, Free/Premium switch, and logout clearing resident data and resetting the plan to Free. Reviewed via `review-phase`: verdict READY FOR COMMIT.

**Known follow-ups**:
- Admin and some consumer badges (`ContentStatusBadge`, admin dashboard badges, the `RequestServiceDialog` success icon) still use the older `text-success`/`text-warning` presentation — the Admin badges were migrated in Visual V5; the `RequestServiceDialog` success icon remains.
- The global focus-ring treatment (`ring-ring/50`, ≈1.9:1 on white, baked into shadcn `Button`/`Badge` and consumer cards) remains for the final accessibility review.
- The shared `EmptyState` renders an `h3`, so a page-level empty state can produce an h1→h3 heading skip.
- Consumer-card WhatsApp/Request buttons (28px) remain smaller than 44px on the Saved page; the consumer header logo/search targets are 32px.
- Cancelled requests cannot show cancellation history (e.g. which step they were cancelled at) because none is stored; request progress shows position only.

## Visual Phase V5 Result

Visual V5 — Admin Refinement = **COMPLETE**. Presentation and accessibility only: the dark Admin header and utilitarian density are preserved, and no moderation or publishing business logic changed.

**Admin dashboard**
- Real counts only: Pending / Approved / Rejected / Archived listings and Published / Draft content, as compact status-badge tiles that link to where those records are managed. No fake charts or analytics.

**Moderation**
- Shared dense `AdminRow` presentation (queue and content list); status, type/category, submitter and date are easier to scan; the primary Review button is filled only for pending items; filters show live counts.
- Compact thumbnails only where a listing has real media (shared fallback on error); otherwise a kind icon — no invented media slots.
- The review dialog is reorganized around the decision: a summary (listing, type, submitter, date, status, any rejection reason) first, the resident preview below, and a sticky action region so Approve/Reject never scroll off-screen on mobile.
- Rejection reason UX/accessibility improved (hint text, `aria-describedby`, readable mobile field). The existing approve/reject validation (10-character minimum) and behavior are preserved.

**Content / news**
- Same shared Admin row treatment; accessible Draft/Published status via `StatusBadge`; operational empty states with real actions; the content form is grouped into Content / Details / Publishing sections with 44px mobile fields. Publishing CRUD and schema behavior are unchanged (the form's "Publishing" field label is now "Visibility", since that is the section title).

**Accessibility**
- The old low-contrast Admin statuses (dashboard icon tiles, `ContentStatusBadge`) migrated to the shared `StatusBadge`; all measured Admin status contrast ≥ 5.45:1; status is always icon + text, never color-only.
- Mobile controls and actions use 44px targets where appropriate; the Admin header nav icons now have accessible labels (`sr-only`).
- Admin-local strong solid focus ring (with a contrasting gap; solid white on the dark header). Dialog focus now starts intentionally at the top of the dialog and returns to the Review control that opened it.
- Global focus-ring debt remains for V6.

**Shared pieces**: new Admin-local `AdminRow`/`AdminThumb`, `AdminStat` and `adminStyles` constants in `src/features/admin/`; `WorkspaceEmpty` gained an optional in-page `onClick` action (backward compatible). See `docs/design/DESIGN_SYSTEM.md` §13.

**Quality**: no dependency added; `npx tsc -b --force` clean; `npm run build` succeeds (JS ≈ 852 KB, +~0.45% vs V4's ≈ 848 KB); lint remains at the established 8-warning baseline; no test suite exists; fresh browser console 0 errors / 0 warnings. Verified at 375/430/820/1440px (no horizontal overflow on any Admin route) and live: admin auth gating/redirect, dashboard, queue ordering and filters, review → approve and reject (including validation and reason display), publish/unpublish, content create/edit/validation, empty filtered states, long-title and image/no-image items, and keyboard focus/dialog behavior. Reviewed via `review-phase`: verdict READY FOR COMMIT.

**Known follow-ups**:
- The global shared focus ring (`ring-ring/50`, ≈1.9:1 on white) remains below the desired contrast and belongs in V6.
- Consumer-card WhatsApp/Request targets remain ~27–28px (visible in the Admin resident preview and on Saved).
- The shared `EmptyState` can produce an h1 → h3 heading skip.
- An Admin logout control does not yet exist (`logout` is in the admin auth context but unused by any UI).
- Approve/Reject remain available on some non-pending listings (including approved/rejected/archived), because V5 intentionally preserved existing business logic; valid moderation state transitions must be explicitly decided before production/backend enforcement.
- The resident preview inside the Admin review dialog still uses the existing consumer card.

## Visual Phase V6 Result

Visual V6 — Final Responsive, Accessibility & Interaction Polish = **COMPLETE**. A cross-app polish pass; no redesign and no business-logic change. Current V6 source scope: 47 modified files, no new files.

**Focus**
- Global/shared focus visibility improved: `--ring` is now the accessible primary green (`#047857`), shared components use a solid ring, and a baseline outline covers anything without its own; the low-contrast ring debt is closed (759 of 764 measured focusables ≥3:1 across 31 routes; the remainder were a measuring artifact on the dark header).
- Admin dark-header focus verified explicitly (solid white ring, 17.85:1, no double indicator).
- The Search pill/submit-button double ring is fixed (the pill ring now follows input focus only).

**Touch**
- Important consumer, workspace and Admin touch targets improved at their shared sources: `Button` and `Toggle` hit areas, 44px inputs on touch, header/footer/Back links, chip-remove and Hero chips.
- The compact Search field now has an effective ~46px touch target without increasing its visual input height: the pill's padding and the decorative icon focus the input; the submit button stays independent.

**Accessibility**
- `EmptyState` heading hierarchy fixed (explicit level; page-replacing states use h1). Representative routes have one meaningful h1 and no heading skips at all six widths; Coming Soon, Analytics, Upgrade and Listings headings corrected.
- The request dialog's success view has an accessible dialog title/description.
- Remaining semantic status color debt closed (the last plain `text-success` uses).
- Admin logout added through the existing Admin auth context (visible only when signed in; labeled on mobile; protected routes redirect afterwards).

**Dialogs / responsive**
- Shared dialog focus return implemented; tall dialogs are viewport-constrained and scrollable; long-token wrapping strengthened (dialog grid, body `overflow-wrap`, flex rows).
- Responsive sweep passed at 320 / 375 / 430 / 820 / 1024 / 1440px with a long-content stress test; no horizontal-overflow regression found.

**Search**
- V2.1 predictive-search behavior preserved: autocomplete, keyboard navigation, Enter submit, debounce, URL sync, Back/Forward, same-mount navigation and zero-result recovery verified.

**Quality**: no new dependencies; no new files; `npx tsc -b --force` clean; `npm run build` succeeds (JS ≈ 854 KB, +~0.2% vs V5); lint remains at the established 8-warning baseline; no automated test suite exists; fresh browser console 0 errors / 0 warnings. Reviewed via `review-phase`: verdict READY FOR COMMIT. See `docs/design/DESIGN_SYSTEM.md` §20.

**Known non-blocking follow-ups**:
- Desktop Footer/Back-link density (44px rows at every width) can be revisited later if desired.
- Real-device/iOS testing is still pending.
- The Admin resident preview still reuses the consumer card.
- Admin moderation transition rules for non-pending states still need an explicit future product/backend decision.
- The large single JavaScript bundle remains and should be addressed through route-level code splitting.

## Food & Dining FD1 Result

Food & Dining FD1 — Domain / Data / Search Foundation = **COMPLETE** (commit `120720f`). Source of truth: `docs/product/FOOD_DINING.md`. FD1 adds no routes and no Food UI beyond the search filters.

**Domain**
- Food is implemented as a Business vertical; `Business.vertical` (`general | food`) is explicit on every Business record, with an optional `food` profile.
- Taxonomy and service options are centralized in `src/config/food.ts`; the primary Food category drives `Business.category`.
- No new Food store, listing kind, Saved kind or Search result kind.

**Data**
- 10 demo Food businesses; Capital Bakers (`business-06`) migrated to Food / Bakeries and no longer appears in the general Directory.
- Image (`cafe.jpg`) and fallback states are represented, as are missing optional fields. No fake ratings, reviews, contact details or popularity.

**Search**
- `vertical`, `foodCategory` and `service` filters are implemented; Food category labels and menu-highlight names are searchable; predictive suggestions include Food terms and resolve to actual Business results.
- Search V2.1 behavior is preserved; URL reload, filter reset on type change, and Back/Forward behavior were verified.
- The Business filter controls scope by Business Type; Food scope shows Food Category and Service selects.

**Compatibility**
- Saved works unchanged with `kind: "business"`; Professional and Admin remain compatible. No architecture changes were required.

**Quality**: no dependencies added; `npx tsc -b --force` clean; `npm run build` succeeds (JS ≈ 862 KB at FD1); lint remains at the established 8-warning baseline; fresh Search console 0 errors / 0 warnings; no automated test suite exists. Reviewed via `review-phase`: READY FOR COMMIT.

**Known limitations**
- (Closed in FD2) The `/food` entry points now exist.
- (Closed in FD3) Food-specific detail presentation now exists on the Business profile; Food cards remain the generic `BusinessCard`.
- (Closed in FD4) Food onboarding exists and `buildBusiness` is Food-safe; `FoodProfile` is preserved through create / edit / resubmit.
- The existing limitation remains: general Business category/area filter options derive from the static seed, not from approved user-submitted listings.

## Food & Dining FD2 Result

Food & Dining FD2 — Discovery = **COMPLETE** (commit `1af5cea`). Source of truth: `docs/product/FOOD_DINING.md`. FD2 adds one route and no new data or domain concepts.

- **`/food` landing page is live:** one h1; a scoped Food search entry; config-backed Food category tiles and service-option shortcuts (wording "Delivery by the business", with a note that B-17 Portal does not deliver); a neutral Food business preview using the existing `BusinessCard`. Food businesses still open at `/businesses/:id`; there is no `/food/:id`.
- **Search reuse:** `/food` has no results engine of its own — every path goes into the existing Search page. Food links carry `type=business&vertical=food` (plus `foodCategory` / `service`); Search V2.1 behavior is preserved.
- **Directory boundary:** General Directory tiles navigate with `type=business&vertical=general&q=<category>`, so Food businesses cannot leak into General Directory searches (verified with a temporary overlap test, since removed). The Directory has one Food & Dining tile to `/food`; Food categories are not shown as General categories.
- **Entry points:** Home tile (the quick-discovery grid is now 6 tiles: 3×2 from 1024px, 6 across from 1280px), Directory tile, a "Food" desktop-nav link, a "Food & Dining" footer link. The mobile bottom nav is unchanged at five destinations. To fit six nav links the header was tightened: nowrap nav links with smaller padding below `xl`, an icon-only "List Your Business" below `xl`, and truncation of long user names.
- **No fake data:** no Featured section (no Food record is `featured`; the preview is neutral and any real flag would simply sort first), no ratings, reviews, popularity, delivery times or distance. Food cards remain the generic `BusinessCard`.
- **Compatibility:** Search regression clean (general, services, tutors, properties, news, zero-result recovery, Back/Forward, suggestions); Saving a Food business works unchanged; responsive verified at 320 / 375 / 430 / 820 / 1024 / 1440 and accessibility checked (one h1, visible focus, 44px service buttons).
- **Quality:** no dependency added; `npx tsc -b --force` clean; `npm run build` succeeds (JS ≈ 869 KB); lint at the established 8-warning baseline; fresh console 0 errors / 0 warnings; no automated test suite exists. Reviewed via `review-phase`: READY FOR COMMIT.

**Known limitations:** the `/food` search box has no Food-scoped predictive suggestions yet; the preview uses the existing static demo business source; Food-specific card presentation, Food onboarding and Admin Food metadata are not implemented (FD4; the Food detail sections arrived in FD3); no Food item in the mobile bottom nav, by design.

## Food & Dining FD3 Result

Food & Dining FD3 — Detail Experience = **COMPLETE** (commit `dd28411`). Source of truth: `docs/product/FOOD_DINING.md`. FD3 adds no route, no data model and no dependency.

- **Food sections live inside `BusinessProfilePage`:** composed conditionally for `vertical === "food"` through `FoodDetailSections`. `/businesses/:id` remains the only Food detail route — there is no `FoodDetailPage` and no `/food/:id`, so there is no duplicate route or detail architecture.
- **Presentation:** a Food & Dining badge; the primary category stays as the subtitle (`Business.category`) with other categories shown as "Also serves"; service options with an explicit "delivery arranged by the business — B-17 Portal does not currently provide delivery" clarification; a display-only hours note (no Open Now logic); informational menu highlights with optional section / description / price (display strings); an optional menu image. Each section is omitted when its data is absent.
- **Preserved:** the generic `BusinessCard` and the Saved architecture (`kind: "business"`) are unchanged; General Business details are unaffected; Search behavior is unchanged. The service-option icon map moved to a shared `src/features/food/foodIcons.ts`.
- **No transactions:** no ordering, cart, quantity, checkout, payment, rating, review or delivery-provider behavior was introduced.
- **Quality:** responsive (320 / 375 / 430 / 820 / 1024 / 1440) and accessibility checks passed (one h1, logical heading order, semantic lists, decorative icons hidden, visible focus); `npx tsc -b --force` clean; `npm run build` succeeds; lint at the established 8-warning baseline; fresh console 0 errors / 0 warnings; JS ≈ 871 KB; no automated test suite exists. Reviewed via `review-phase`: READY FOR COMMIT.

**Known limitations:** no permanent demo `menuImage` exists; hours are free text; the generic `BusinessCard` / Saved presentation remains. (Food creation / editing arrived in FD4.)

## Food & Dining FD4 Result

Food & Dining FD4 — Listing / Professional / Admin Integration = **COMPLETE** (commit `3d6ba96`). Source of truth: `docs/product/FOOD_DINING.md`. FD4 adds no route, no store and no dependency; Food stays a `kind: "business"` listing with `vertical: "food"`.

- **Merchant flow:** Business onboarding offers General Business or Food & Dining; Food reveals `FoodListingFields` (1–3 canonical categories, first = primary; at least one service option — a frozen requirement; optional hours note; up to 8 menu highlights; optional menu image). Create, preview, edit (full prefill) and resubmit all work for Food.
- **`FoodProfile` lifecycle:** verified to survive create → pending → reject → edit → resubmit → approve → archive. The previously Food-unsafe `buildBusiness` now builds General or Food correctly, and `Business.category` is derived from the primary Food category (no second editable source).
- **Professional Workspace reused:** Food listings are labelled "Food & Dining · <categories>"; the preview and "View" dialog show a shared Food summary. Quota and lifecycle are unchanged (pending + approved count; rejected / archived do not). No Food dashboard, analytics or orders.
- **Admin:** the existing moderation queue shows Food identity and categories; the review panel shows categories, services, hours, menu highlights and menu image. Moderation rules are unchanged.
- **Public integration:** an approved Food listing is found by Search (name, primary / secondary category, menu-item name, service and vertical filters), renders the FD3 detail sections, and saves as `kind: "business"`. The menu-price caption is now neutral for demo and merchant data ("Prices shown are for reference and may change.").
- **Compatibility:** General Business create / edit / moderation / public detail verified unchanged (no Food fields, no `food` key). No ordering, payment or premium features were added.
- **Quality:** `npx tsc -b --force` clean; `npm run build` succeeds (JS ≈ 888 KB); lint at the established 8-warning baseline; fresh console 0 errors / 0 warnings; responsive (320 / 375 / 430 / 820 / 1024 / 1440) and keyboard-focus checks passed; no dependency added; no automated test suite exists. Reviewed via `review-phase`: READY FOR COMMIT.

**Known limitations:** cover and menu images are browser-local (frontend prototype); Food → General discards Food data when saved (an inline warning was added in FD5); Food cards / Saved stay generic; no backend persistence or storage.

## Food & Dining FD5 Result

Food & Dining FD5 — Final QA / Accessibility / Documentation = **COMPLETE** (commit `431b954`). The **Food & Dining frontend expansion (FD1–FD5) is COMPLETE**; `docs/product/FOOD_DINING.md` is the final frontend source of truth (current implementation, known limitations and reserved future work are separated there). FD5 added no route, store, data model or dependency and did not redesign FD1–FD4.

- **QA coverage (all passed):** `/food` (11 categories, 3 services, preview, View all, `vertical=food` links); Search V2.1 (Food / General scoping, `foodCategory` + `service` combinations, menu-item and secondary-category matching, suggestions with keyboard / Enter / Escape, Back / Forward, filter reset, refresh preserving URL state); Food detail for every seed Food business and the general ones (no blank sections, neutral price caption, no Food sections on General); the merchant lifecycle create → pending → reject → edit → resubmit → approve → archive with `FoodProfile` preserved and `Business.category` re-derived; Professional quota; Admin queue and review (reject-reason validation, focus return); Saved (`kind: "business"`, save / unsave); the General Business lifecycle (`vertical: "general"`, no `food` key); minimal / maximal / long / name-only-menu Food profiles; form validation limits.
- **Fix:** an inline accessible warning ("Switching to General Business will remove Food-specific details when saved.") now appears when Food details exist and General is selected. No other bug was found.
- **Responsive / accessibility:** clean at 320 / 375 / 430 / 820 / 1024 / 1440 across the Food surfaces (including the create form with errors and 8 menu rows, Professional listings and View, Admin queue and review); one h1 and logical headings; native radios / checkboxes with real state; named Add / Remove controls; linked errors; visible focus; dialog focus return verified.
- **Quality:** `npx tsc -b --force` clean; `npm run build` succeeds (JS 887.94 kB / gzip 264.76 kB, CSS 73.60 kB — vs FD4: +0.34 kB JS); lint at the established 8-warning baseline, no new category; fresh console 0 errors / 0 warnings; no dependency added; no automated test suite exists.

**Known limitations:** see `docs/product/FOOD_DINING.md` — no backend persistence; browser-local images; free-text hours; generic Business card / Saved presentation; no restore after Food → General; archived saved items are hidden under the existing Saved rules; the large-chunk build warning was resolved by Phase 9H.

## Phase 9H Result

Phase 9H — Performance & Route-Level Code Splitting = **COMPLETE** (commit `c2871f7`). Performance only: no route, URL, guard, redirect, auth, business-rule, Search, listing-lifecycle, visual or data change; no dependency added; no `manualChunks` / `codeSplitting` config.

- **Strategy:** `router.tsx` converts every page to `React.lazy` through a small `lazyPage(() => import(...), "Name")` adapter (pages use named exports). **Eager:** the three layout shells (`ConsumerLayout`, `ProviderLayout`, `AdminLayout` — small, needed by every route in their tree), `HomePage` (the common landing screen — lazy-loading it would add a request waterfall to `/`), and the ~1 KB `ComingSoonPage` / `NotFoundPage`. **Lazy:** every other consumer page (Search, Services, Provider profile, Directory, Food, Business profile, Education, Tutor profile, Property + detail, News + article, Login/Register, Resident Overview/Saved/Requests), all nine Professional pages, and all five Admin pages. Route guards, redirects and URLs are untouched (they run inside the pages exactly as before).
- **Loading UX:** `RouteOutlet` (`src/app/RouteOutlet.tsx`) wraps each layout's `<Outlet/>` in `Suspense` keyed by the matched route id, with the shared `RouteFallback` (`src/components/feedback/RouteFallback.tsx`: a `role="status"` "Loading page" label and a decorative spinner; no dependency, no fake progress; reserved `min-h-[50svh]` so nothing jumps; reduced motion handled by the global CSS). The key matters: React Router updates run in a transition, which would otherwise keep the previous page frozen on screen instead of showing the fallback; keying by route (not URL) shows the fallback when moving between routes while a same-route param change (e.g. `/businesses/1` → `/businesses/2`) keeps the page mounted exactly as before. The header/footer/mobile nav stay in place during loading.
- **Result (before → after):** initial JS for Home — one 887.94 kB (gzip 264.76 kB) chunk → entry 342.31 kB + `motion` 255.47 kB + 8 tiny shared chunks ≈ 609 kB raw / ≈ 195 kB gzip (≈ −31% raw, ≈ −26% gzip); Home requests exactly 10 JS files and no Professional / Admin / form / zod code. CSS 73.60 kB → 73.76 kB (gzip 12.50 → 12.56). The Vite large-chunk (>500 kB) warning no longer appears (largest chunk 342 kB). Notable lazy chunks: `schemas` (zod + form libs) 108 kB, `PropertyListingForm` 25 kB, `SearchPage` 18 kB, `toggle-group` 17 kB (shared by Search / Admin), `ProviderProfilePage` 9 kB, `ModerationQueuePage` 8 kB, `ProfessionalListingsPage` 8 kB; ~77 JS files in total.
- **Verification:** `npx tsc -b --force` clean; `npm run build` succeeds; lint at the established 8-warning baseline, no new category; `package.json` / lockfile unchanged. Verified on the production build served statically: direct URL / refresh of every route (37 URLs incl. details, guards, 404) loads; Search V2.1 (URL source of truth, suggestions, Food filters, Food/General separation, Back/Forward); Service, General Business, Food and Property create → preview → submit → edit → resubmit; Admin login, dashboard, moderation approve/reject, content list/new/edit; a throttled network (artificial chunk delay) shows the fallback inside the intact shell with no overflow at 320px; responsive sweep at 320 / 375 / 430 / 820 / 1024 / 1440; keyboard focus stays on the activated nav link; heading structure unchanged; production and dev consoles 0 errors / 0 warnings.
- **Known remaining performance limitations:** `motion` (255 kB, shared by Home) is part of the initial load — trimming it (e.g. `LazyMotion`) would touch many components and is a separate optimisation; Rolldown's automatic splitting produces many tiny shared chunks (judged acceptable; a conservative grouping can be revisited if request counts matter); no route prefetching (deliberately not added); no automated bundle-size budget; images/fonts are untouched.

## Phase 9G Result

Phase 9G — PWA / Installability = **COMPLETE** (commit `5c3e6d6`). B-17 Portal is an installable PWA; the website works unchanged without installing. No route, URL, guard, auth, Search, listing-lifecycle or business-rule change; **no dependency added** (hand-written service worker emitted by a ~30-line Vite plugin; `vite-plugin-pwa` / Workbox deliberately not used — they would add a large dependency tree and Vite 8 / Rolldown compatibility risk for a small, fixed need). No push notifications, no Background Sync, no offline mutation queue, no Capacitor / Android / iOS project, no store packaging, no sharing / deep links.

- **Manifest (`public/manifest.webmanifest`):** `id` / `start_url` / `scope` `/`, `display: standalone` (orientation not locked), name / short name "B-17 Portal", description, `theme_color` `#047857` (the design system's primary green), `background_color` `#ffffff`, icons 192 / 512 (`any`) and 512 (`maskable`). `index.html` links the manifest, an Apple touch icon, `theme-color`, `mobile-web-app-capable` / `apple-mobile-web-app-capable` and the Apple app title.
- **Icons (`public/icons/*`, `public/apple-touch-icon.png`):** built from the app's existing brand mark — the primary-green rounded square with the lucide `MapPin` glyph used in the Header — not a new identity. 192 / 512 rounded, a full-bleed maskable 512 (glyph inside the safe zone), a 180 px full-bleed Apple touch icon. `public/favicon.svg` previously held the stock Vite starter logo and was replaced with the same brand mark. Generated once from a canvas; the generator is not part of the repo. `public/images/brand/` remains empty (no separate logo asset exists).
- **Service worker (`pwa/sw.template.js` → `dist/sw.js`, emitted at build by `serviceWorkerPlugin` in `vite.config.ts`):** precaches only the app shell (`/` plus the JS / CSS that `index.html` itself loads — 12 entries, ≈ 690 kB, i.e. exactly Home's initial path). **Lazy route chunks (Phase 9H) are NOT precached**; `/assets/*` (content-hashed) are cached on first use (cache-first). Navigations are network-first with the cached shell as the fallback, so React Router direct URLs, refresh, lazy imports, auth redirects and the 404 page keep working, offline included. Everything else — other origins, non-GET requests, `/images`, any future API — is not intercepted (no data caching). One cache per build id (`b17-<hash>`); old caches are deleted on activate. Registered in production builds only; `vite dev` never registers a worker.
- **Update strategy:** a new worker installs in the background and waits. The page shows "A new version of B-17 Portal is available" with **Refresh** / **Later**; Refresh sends `SKIP_WAITING`, the worker takes over, and the page reloads exactly once (flag-guarded, no loop). Nothing reloads automatically. The "Try again" action on a failed route also applies a waiting update before falling back to a plain reload.
- **Install UX (`src/pwa/install.ts`, `src/hooks/usePwa.ts`, `src/components/pwa/InstallPrompt.tsx`):** a quiet in-flow strip just above the Footer (never a modal / overlay; the site is fully usable without it). `beforeinstallprompt` is captured at startup and exposed as a real **Install** button (Android / Chromium, desktop Chrome / Edge); iOS / iPadOS gets "Tap Share, then Add to Home Screen" (no fake dialog); nothing shows when already installed / standalone (`display-mode: standalone | minimal-ui`, `navigator.standalone`), after `appinstalled`, or where the browser has no install path (e.g. desktop Firefox). Dismissal is a single `localStorage` timestamp (`b17.pwa.installDismissedAt`, suppresses the strip for 30 days; stores nothing personal).
- **Offline (`RouteError`, `PwaStatus`):** pages already opened work offline from the cache; a page whose chunk was never cached shows an accessible "You're offline — Check your connection and try again" state *inside* the intact layout shell (via an error boundary in `RouteOutlet`, keyed by route), with a "Try again" button; a polite `role="status"` notice says "You're offline. Pages you haven't opened yet may not load." Mutations fail closed: every state-changing action on business / product data (create / edit / resubmit / archive listings, Admin approve / reject, Admin news create / edit / publish, service requests, lead status changes, plan switch) first calls the shared `useRequireOnline()` guard (`src/hooks/useRequireOnline.ts`); when `navigator.onLine` is false it stops before touching any store and shows an error-tone toast (`role="alert"`, offline icon) "You're offline. Reconnect to make changes." — no success message, no navigation, no state change, form input kept, nothing queued or retried. Device-local Saved favorites (persisted in `localStorage` on the device) intentionally still work offline. `navigator.onLine` is only a best-effort signal (it can be true on a connection with no internet); real write handling belongs to the backend phase.
- **Verification (production build, real headless Chrome driven over CDP — the in-app Browser pane cannot register service workers):** the worker registers, activates and controls the page; `Page.getAppManifest` reports no errors and `Page.getInstallabilityErrors` is empty; 11 direct-URL / refresh routes (home, search, food, details, login redirect, admin redirect, 404) load under the worker; the real `beforeinstallprompt` drives the Install CTA, and a synthetic event confirms `prompt()` is called and `appinstalled` hides it; dismissal persists; a Chrome `--app` window (standalone) hides the strip; an emulated iPhone / iPadOS UA with no install event shows the Share guidance with no Install button, and iOS standalone hides it; with the server dropped and the page offline, visited routes load and unvisited ones show the offline state (soft and hard navigation); Try again recovers once back online; a simulated redeploy produced a waiting worker, the update card, one reload, the old cache deleted and no reload loop; login, Professional and Admin routes are unaffected; the responsive sweep (320 / 375 / 430 / 820 / 1024 / 1440) with the install strip, update card and offline notice all visible has no overflow and nothing covers the strip; the install / update controls are named, keyboard-reachable with the green focus ring, and do not trap focus; production and dev consoles 0 errors / 0 warnings (the only console noise is the expected network / dynamic-import failures logged while deliberately offline). **Not physically tested:** a real Android device, a real iPhone / iPad (iOS behavior is verified by UA / `navigator.standalone` emulation and code review only), Safari, Firefox, and the OS-level installation dialog itself (only its trigger).
- **Performance (vs Phase 9H):** Home initial JS 608.8 → ≈ 616.8 kB raw (+≈ 8.0 kB, +1.3%; entry chunk 342.31 → 350.19 kB, gzip 104.53 → 106.83 kB, i.e. the PWA / error-boundary / offline-guard code); CSS 73.76 → 73.99 kB (gzip 12.56 → 12.61); `sw.js` 3.0 kB (1.4 kB gzip); `dist/assets` 76 JS files (unchanged); no Admin / Professional page code on Home; the >500 kB chunk warning stays gone. The worker's install step re-downloads the ≈ 690 kB shell once (served from the browser cache where possible) — an install-time cost, not on Home's critical path.
- **Quality:** `npx tsc -b --force` clean; `npm run build` succeeds; lint at the established 8-warning baseline, no new category; `package.json` / lockfile unchanged.
- **Hosting requirements (documented, not enforced here):** serve `sw.js` with `Cache-Control: no-cache`, `manifest.webmanifest` as `application/manifest+json`, HTTPS in production, and an SPA fallback to `index.html` for unknown paths.
- **Known limitations:** per-route `<title>` / meta (listed in the roadmap's 9G scope) was deferred to Phase 9J and is now done; install behavior on real devices is untested (see above); no prefetching; the first-time install re-fetches the shell; a never-visited route cannot load offline; images are not cached; if a deploy removes a lazy chunk an old open tab needs, the user sees "This page couldn't load" and must Refresh / Try again; offline writes are blocked client-side only (best-effort `navigator.onLine`; real handling is a backend-phase concern); no maskable-icon visual review on real launchers; no share / deep-link, push, native, or store work (later phases).

## Phase 9J Result

Phase 9J — SEO + Accessibility Tooling + Final Frontend QA = **COMPLETE** (commit `50e39b9`). Hardening only: no new product feature, route, dependency (`package.json` / lockfile unchanged), backend, analytics / tracking, notification permission, sharing / deep link or store packaging.

- **SEO architecture (no dependency; no React Helmet):** one mechanism. `src/config/seo.ts` is the single home of the site name / description, the title helpers and the **site-URL seam**; `src/seo/routeSeo.ts` holds one table with a title / description / indexing rule for every route; `src/seo/entitySeo.ts` builds descriptors for the detail pages from fields already public on the page; `useSeo` lets a page publish its descriptor into a tiny store (`seoState.ts`); `SeoManager` (rendered once per layout inside `RouteOutlet`) is the **single writer** of `document.title`, description, robots, canonical and the Open Graph / Twitter tags (`applySeo.ts` updates the static tags in `index.html` in place, creates missing ones and removes tags that do not apply — one canonical, no duplicates).
- **Titles / descriptions:** Home "B-17 Portal | Local Services, Property, Food & More"; landing pages "<Topic> in B-17 | B-17 Portal"; detail pages "<entity name> | B-17 Portal" with a description derived from the entity's own public text (category / area / description, truncated at a word boundary); a missing entity gets a "<thing> not found" title and `noindex`. Every route — including private ones — has a real title (also WCAG 2.4.2). No superlatives or unsupported claims.
- **Canonical / URL strategy:** no production domain is configured, so none is hard-coded. `VITE_SITE_URL` (build time; documented in `.env.example`) drives absolute canonical / og:url / og:image URLs and the build-time sitemap; when unset the page's own origin is used (always correct for any preview / staging host). `VITE_SITE_NOINDEX=true` forces `noindex, nofollow` on every route for staging / demo deployments (all listing data is fictional). Canonicals follow the existing route architecture (`/businesses/:id` for Food too — no duplicate Food URLs).
- **Indexing strategy:** indexable — Home, `/services`, `/directory`, `/food`, `/education`, `/property`, `/news` and the public detail pages. `noindex, nofollow` — login / register, Resident (profile, saved, requests), the whole Professional workspace, Admin, the Coming-Soon stubs, and every unknown URL (404). **`/search` is `noindex, follow` with canonical `/search`**: its `q` / `type` / `vertical` / `foodCategory` / `service` combinations are an effectively unlimited set of thin result pages, so discovery is left to the landing and detail pages. Search behavior is unchanged.
- **Social metadata:** Open Graph + Twitter tags are written per route; detail pages use the entity's public image (`/images/...` only — never `blob:` previews) with `summary_large_image`, everything else uses the app icon (the only brand image in the repo, square, so `summary`). Static site-wide defaults (title, description, og:site_name / type, twitter:card) sit in `index.html` for crawlers that do not run JavaScript. **Known SPA limit:** link-preview bots and non-rendering crawlers see only those static defaults, not per-route tags — per-page previews need pre-rendering / SSR or an edge function (backend / hosting phase). Googlebot renders JavaScript and sees the runtime tags.
- **robots.txt (`public/robots.txt`):** just `User-agent: *` / `Allow: /` — nothing is disallowed. Keeping pages out of search is the job of the page-level `noindex` metadata (login / register, Resident, Professional, Admin, 404 → `noindex, nofollow`; `/search` → `noindex, follow` with canonical `/search`), and a crawler can only see that directive if it may fetch the page; the JS / CSS under `/assets` also stay crawlable. robots.txt is crawl guidance, not access control or protection for private areas — the file says so. A `Sitemap:` line is appended only when `VITE_SITE_URL` is set.
- **Sitemap:** generated at build only when `VITE_SITE_URL` is configured, listing the stable top-level public routes (`/`, `/services`, `/directory`, `/food`, `/education`, `/property`, `/news`), with no invented `lastmod`. Individual businesses / providers / properties / news are demo data today, so a per-entity sitemap is deferred to the backend / database.
- **Structured data:** deliberately NOT added. There is no real entity data to support Organization / LocalBusiness (no address, phone, hours), News dates and authors are demo values (no reliable `Article`), and there are no ratings / prices / availability to claim. Revisit with real data and a real domain.
- **404:** clear title, `noindex, nofollow`, now exactly one h1 (it previously rendered an h2 only) and a link back to Home; all unknown paths, including `/provider/...`, `/admin/...` and `/profile/...` sub-paths, reach it with the full header navigation.
- **Accessibility fixes made:** a keyboard "Skip to main content" link in all three layouts (focus moves to `<main id="main-content">` without changing the URL; WCAG bypass blocks was previously met only by landmarks); 404 heading level; card / dialog / admin thumbnails now use `decorative` images (empty alt, hidden placeholder) where a visible title already names the item, so card names are no longer announced twice (detail hero and menu images keep meaningful alt text).
- **Accessibility audit — what was actually run:** axe-core and Lighthouse are NOT installed and were NOT run (nothing was downloaded). Used instead: real headless Chrome driven over the DevTools protocol — the Accessibility tree (every button / link / field has an accessible name), custom DOM audits (one h1, no heading skips, one `main`, landmarks, image alt, duplicate ids, dangling `aria-*` references, positive tabindex, focusable elements inside `aria-hidden`, empty links, `#` links) on 31 routes / states (public, Resident, Professional, create-listing form with errors, Admin, review dialog), a custom WCAG text-contrast scan (light theme; text over photos / gradients excluded) on 9 routes, and real key-press tests (Tab / Shift+Tab / Enter / Escape). Result: no blockers, no failures. Forms: labels, linked `role="alert"` errors, focus moves to the first invalid field, `autocomplete="name"` on login; dialogs (service request, listing preview, Admin review incl. reject): correct title / description, initial focus inside, focus trapped, Escape closes, focus returns to the opener.
- **Touch targets:** at 320 / 375 the only sub-44px control found was the compact Search input (222 × 36), whose 343 × 46 pill is the real tap target (a press on the pill focuses the input) — no change needed. Desktop-density controls (≥ 768px) were not enlarged.
- **Navigation / links:** 74 distinct internal links collected from the public, Resident, Professional and Admin surfaces all resolve; no `#` / href-less anchors, no unsafe `target=_blank`; no external links. Copy review: no placeholder / TODO text; remaining "Coming Soon" labels are for intentionally deferred modules.
- **Responsive:** 34 surfaces (public, detail, auth, 404, Resident, Professional, create-listing form with Food block and errors, Admin dashboard / queue / content, Admin review dialog, PWA offline / install states) × 320 / 375 / 430 / 820 / 1024 / 1440 — no horizontal overflow or clipped text; the Professional tab bar is an intentional horizontally scrollable list at 320; the skip link is visible and in view; dialogs fit the viewport.
- **PWA regression (Phase 9G):** service worker registers / controls, 0 manifest / installability errors, install CTA, iOS guidance, standalone hiding, dismissal, update prompt (one reload, no loop), offline browsing, offline "You're offline" route state and offline mutation safety (all six mutation attempts blocked offline, working online) all re-verified on the new build.
- **Performance regression (Phase 9H):** Home initial JS ≈ 616.7 → 623.1 kB raw (+1.0%), 195.9 → 197.7 kB gzip; entry chunk 350.19 → 356.58 kB; CSS 74.05 → 75.14 kB; motion chunk unchanged; 77 JS files; largest chunk 356.6 kB; the >500 kB warning stays gone; no Admin / Professional code on Home.
- **Quality:** `npx tsc -b --force` clean; `npm run build` succeeds (also with `VITE_SITE_URL`); lint at the established 8-warning baseline, no new category; fresh-session console 0 errors / 0 warnings in dev and production (including soft navigation across 20+ routes). **Not run:** Lighthouse, axe, real-device and screen-reader testing (VoiceOver / TalkBack / NVDA), Safari / Firefox.
- **Security / privacy sanity:** no secrets, API keys or `.env` files committed (only `.env.example`); metadata is built from already-public page text (no contact data, submitter names or internal ids beyond the canonical URL; `blob:` images excluded); the SEO code stores nothing; no notification permission is requested; no tracking SDK; `noindex` / robots are indexing hints, not security.
- **Remaining frontend limitations / open items:** per-page link previews and server-side title / meta need pre-rendering or SSR (hosting / backend phase); no per-entity sitemap and no structured data until real data exists; Lighthouse / axe / screen-reader / real-device testing still to be done; dark mode is not user-reachable (not audited); the three low-risk cleanup items from the original 9J roadmap scope (the unlinked `/services/home-construction` stub, the orphaned demo images, the `shadcn` dependency) were closed in Phase 9L; the Phase 9F (Admin Production UX) and 9I (Notifications + Trust/Reviews UI) items remain unscheduled product decisions.
- **Frontend readiness verdict:** the frontend is coherent, responsive (320–1440), accessible to the extent verified above, installable, performance-split, SEO-aware, navigationally stable and documented — **ready to be frozen as the baseline for backend integration.** No true blockers were found; the limitations above are either backend-phase concerns or low-risk cleanup.

## Phase 9L Result

Phase 9L — Frontend Cleanup & Technical Debt Closeout = **COMPLETE** (Phase 9L commit: pending). Cleanup only: no product feature, no UI redesign, no business-behavior change, **no dependency added, removed or upgraded** (`package.json` / lockfile unchanged), Search untouched.

- **Route cleanup:** `/services/home-construction` was an obsolete Phase 1 stub — wired only in `router.tsx`, `routes.ts` (`servicesConstruction`) and the SEO route table, with no inbound link, data or search destination (`/services` is the real "Home & Construction Services" page). Removed from all three places; the URL now resolves to the normal 404 (title, `noindex`, h1). `ComingSoonPage` stays: it serves `/coming-soon`, linked from the footer / Home for the deferred modules (Marketplace, Pharmacy, Pick & Drop, Community, B-17 Vault); its doc comment was updated. No valid route was removed.
- **Asset cleanup:** every file under `public/` was cross-checked against source, CSS, data files, `index.html`, the manifest, the SEO config, the PWA worker, `vite.config.ts` and docs (and for dynamically built paths — none exist). 19 demo photos (≈ 47 MB, tracked in git, referenced nowhere, not documented as intentional — the "19 orphaned images" already flagged in this file) were removed: `businesses/` electronics-store, hardware-store, home-improvement-store; `hero/` hero-b17-demo-02, 03, 04, 05, 06, 08, 10; `properties/furnished-apartment`; `services/` architecture, construction, electrical, interior-design, plumbing, renovation, solar; `tutors/cs-tutor`. `public/images` shrank from 51 MB to 3.9 MB (the built `dist` ≈ 5.4 MB). Kept: the favicon, Apple touch icon, all PWA icons, the manifest, `robots.txt`, the empty `images/brand/` placeholder folders, and every image any code references (30 distinct `/images/...` paths re-verified to serve as real images; 55 `<img>` elements on 21 pages all load).
- **`shadcn` dependency audit:** the package is NOT imported by any source file, but `src/index.css` does `@import "shadcn/tailwind.css"`, which defines the Tailwind custom variants (`data-open`, `data-closed`, `data-checked`, `data-vertical`, …) that the generated `dialog.tsx`, `sheet.tsx` and `toggle-group.tsx` rely on. Removing it would silently break those components' state styling, so it was kept. It is a build-time dependency only (nothing from it ships as JavaScript); it could move to `devDependencies`, but dependency changes other than removing a proven-unused package were out of scope. Radix and the other UI dependencies were not touched.
- **Dead code:** a reachability / export audit of `src/` found exactly two unreachable files, both unreferenced since Phase 1 and removed: `src/hooks/useMediaQuery.ts` (`useMediaQuery`, `useIsDesktopNav`) and `src/hooks/useReducedMotion.ts` (reduced motion is handled globally by `MotionConfig` and CSS). Exports used only inside their own file (the generated UI primitives' variant / part exports, small types) were deliberately left. No `console.*`, `debugger`, TODO / FIXME, commented-out code or lorem text exists in `src/`; the one `@ts-expect-error` (`zodResolver.ts`) is documented and kept; "temporary" / "mock" matches are legitimate copy or comments.
- **Package hygiene:** `npm outdated` was run for information only (minor / patch updates available for Vite, React Router, radix-ui, lucide-react, motion, zod, react-hook-form and others; major versions available for `motion` 14, `typescript` 7, `@types/node` 26, `cn` 0.4). Nothing was upgraded.
- **Search:** untouched (ranking, suggestions, filters, cards, layout, query semantics). **Search UX refinement is intentionally deferred** and will be reviewed during Phase 9M (Playwright + MCP) testing.
- **Regression:** PWA (service worker controls the page, 0 manifest / installability errors, install CTA, iOS guidance, standalone hiding, dismissal, update prompt with one reload and no loop, offline browsing, offline route state, all six offline mutation blocks) and SEO (per-route titles / canonical / robots, `/search` `noindex, follow`, 404 `noindex`, robots.txt `Allow: /` only, sitemap emitted only with `VITE_SITE_URL`) re-verified on the new build. Performance: entry chunk 356.58 → 356.42 kB, Home initial JS ≈ 622.9 kB raw / 197.7 kB gzip (effectively unchanged), 77 JS files, no >500 kB warning, no Admin / Professional code on Home. Smoke test (fresh sessions, production and dev): Home, Search, Food, Property, Professional, Admin, 404 and the PWA install / offline UI — 0 console errors / warnings. `tsc` clean; lint at the established 8-warning baseline.
- **Remaining frontend debt:** no automated test suite; no SPA-fallback hosting config; Lighthouse / axe / screen-reader / real-device testing still to be done; `shadcn` in `dependencies` (build-time only); `CategoryCard` / `NewsCard` hand-roll their card surface; per-page server-side metadata, per-entity sitemap and structured data wait for the backend; Search UX review deferred to Phase 9M.

## Phase 9M Result

Phase 9M — Automated Testing Foundation + Playwright E2E + MCP-Assisted QA = **COMPLETE** (commit `d586f45`). Phase 9L is committed as `5ed1799`.

- **Tooling (devDependencies only):** Vitest 5 + jsdom + React Testing Library + user-event + jest-dom, and `@playwright/test`. No Jest/Cypress/Selenium. Scripts: `test`, `test:run`, `test:watch`, `test:e2e`, `test:e2e:headed`, `test:e2e:ui`, `test:e2e:report`. Commands, strategy and gaps: `docs/development/TESTING.md`.
- **Unit + component:** 14 files / 168 tests (Search service, Food config, listing builders/schemas, SEO, stores, SearchBar, FilterControls, FoodListingFields, ListingForm, result-card accessibility, offline guard, InstallPrompt, route fallback/error, PwaStatus).
- **E2E:** 9 spec files / 68 tests — desktop 58, mobile (Pixel 7) 6, PWA 4 — against the production build served by `vite preview` on explicit `127.0.0.1:4173` (never `localhost`, which can resolve to IPv6). No arbitrary waits. Functional projects block the service worker; only the `pwa` project allows it. Isolation by fresh contexts; no test-only code ships.
- **Journeys covered:** Home→Search→detail→Save→Saved→unsave; Search (URL source of truth, suggestions, Food vs General, empty state, nested-interactive regression); Professional create→Admin reject with reason→edit & resubmit→approve→Search→Food detail; General and Service listings; Property lifecycle; route guards and role separation; SEO/robots/canonical/404; every public route by direct URL; mobile nav/filters/forms; PWA manifest, service worker, offline browsing and blocked offline mutations.
- **Bug found and fixed by 9M:** Search result cards exposed a Save button nested inside a "Preview X" button (nested interactive controls, WCAG 4.1.2). Reproduced with a failing test, fixed with the smallest semantic change (non-interactive card surface + one stretched named overlay button, `CardPreviewTrigger`, with independent Save/action buttons above it) in `BusinessCard`, `ProviderCard`, `TutorCard`, `PropertyCard`; no visual change, no Search-semantics change; regression-tested in Vitest and Playwright.
- **MCP review:** Playwright MCP exploratory Search review (desktop + mobile) recorded in `SEARCH_UX_FINDINGS.md` — one blocker (above, fixed), two LOW open items (32 px Save touch target; suggestion list overlays filters until dismissed), the rest verified and pinned by tests.
- **CI:** `.github/workflows/frontend-ci.yml` (push/PR to `master`): tsc → lint → Vitest → build → Playwright Chromium; no secrets, no deploy; report/traces uploaded. Frontend CI run #1 on `d586f45` passed (every step green).
- **Verification at completion:** `tsc -b --force` clean; lint 8 warnings (baseline); Vitest 168/168; build OK; Playwright 68/68 (two consecutive full runs, no retries).
- **Unchanged:** product behavior, Search ranking/semantics, routes, data, PWA, SEO; no backend.

## Phase 10A Result

Phase 10A — Backend Architecture & Contract Freeze = **COMPLETE** (commit `e60a0b6`). **Documentation only** — no backend code, FastAPI scaffold, Python dependency, database, migration, Docker file, auth, API or frontend change; no npm dependency added.

- **Documents (new, `docs/backend/`):** `BACKEND_ARCHITECTURE.md` (stack, layers, folder design, transactions, concurrency, config/CORS/logging/security baseline, testing, migrations policy, phase map), `DATA_MODEL.md` (frontend contract audit, entities, listing subtype model, categories, lifecycle/history, constraints, indexes, delete policy, open questions), `API_CONTRACT.md` (REST conventions, envelopes, errors, pagination/filtering, resource groups), `AUTH_RBAC.md`, `MEDIA_STORAGE.md`, `DEPLOYMENT.md`.
- **Architecture frozen:** modular monolith (FastAPI + Pydantic v2 + synchronous SQLAlchemy 2.x + Alembic + PostgreSQL + pytest, REST under `/api/v1`); routers → services → repositories → models; services own transactions. No Redis, queues, search engine or microservices.
- **Data model frozen:** UUID ids; one `listings` base table + shared-PK subtype tables (`business_profiles`, `property_profiles`, `tutor_profiles`; no empty provider subtype); Food stays **business + vertical** (`food_profiles` tied to a food-vertical business by composite FK; `food_menu_items` capped at 8 by constraint); one `categories` table keyed by a code-defined module with `listing_categories` (position 1 = primary, max 3); `listing_status_history` (append-only, with an `action` column); one `saved_items` table; `news_articles` separate from listings.
- **Contracts frozen:** camelCase JSON matching the frontend types, omitted-not-null optionals, `{data, meta}` / `{error}` envelopes, offset pagination (default 12, with total), query keys identical to the Search URL keys, state changes as actions (never a `status` write), `listings.revision` as the integer concurrency/version counter that guards moderation and conflicting updates (current requirement); `PATCH` semantics: omitted = unchanged, explicit `null` = clear (only for fields the domain allows clearing).
- **Frontend-vs-backend conflicts found (all documented, none changed):** admin UI allows Approve/Reject on any status including archived (backend stricter); an edit takes an approved listing offline (preserved); no contact data exists anywhere in the model; `submittedBy` is a name, not an id; `blob:` image URLs can never be stored; `Provider.category` is a slug but `Business.category` a label; General-business category and news category are free text (taxonomy needed); area is free text with an exact-match filter; Food spec's `food_category` vs the shipped `foodCategory` URL key.
- **Deferred on purpose:** token/session mechanism, OAuth provider setup, email provider, hosting provider, media implementation, notifications, personalization, payments, content-version history (full snapshots of past listing content — the simple `revision` counter is current, not deferred), `draft` status, professional verification.
- **Roadmap:** backend phases re-sequenced as 10A → 10B (FastAPI foundation) → 10C (data layer) → 10D (read APIs) → 11 (auth/RBAC) → 12 (write APIs + integration) → 13 (media + deployment); see `ROADMAP.md`.

## Phase 10B Result

Phase 10B — FastAPI Project Foundation = **COMPLETE** (commit `4d73c59`). The first backend implementation phase. **No database, SQLAlchemy, Alembic, Docker, auth or domain API, and no frontend change.**

- **Project:** `backend/` — `pyproject.toml` (setuptools; Python ≥3.12; runtime deps `fastapi`, `uvicorn`, `pydantic-settings`; dev deps `pytest`, `httpx`, `ruff`, `mypy`), project-local `backend/.venv` (git-ignored), `.env.example`, short `README.md`.
- **Application:** `app/factory.py` (`create_app(settings)`, import-side-effect-free) + `app/main.py` (`app = create_app()` for `uvicorn app.main:app`); `app/core/{config,errors,logging}.py`; `app/middleware/{request_id,request_log}.py`; `app/api/{routing,error_handlers}.py`, `app/api/v1/{router,health}.py`; `app/schemas/envelope.py`; `app/dependencies/settings.py`.
- **Behavior:** `GET /api/v1/health` → `{"data": {"status": "ok", "service": "b17-portal-api", "version": "…"}}` (liveness only; `meta` omitted per the null/omitted rule); every response carries `X-Request-ID` (valid incoming ids are kept, others replaced with a UUID4); all errors use `{"error": {code, message, details?, requestId}}` — validation (422 with `{field, code, message}` details, never the input), malformed JSON (400), unknown routes (404), wrong method (405), application errors (`AppError`) and unexpected exceptions (generic 500; traceback logged server-side only); one structured JSON log line per request (path without query string); explicit-origin CORS from `FRONTEND_ORIGINS` (wildcards rejected, credentials off until Phase 11); OpenAPI + `/docs` + `/redoc` outside production only.
- **Tooling:** pytest (75 tests, no database, isolated from the real `.env`/environment), ruff (lint + format), mypy strict — all clean; `.github/workflows/backend-ci.yml` runs them on `backend/**` changes. Frontend CI unchanged.
- **Scope changes recorded:** the API Dockerfile and Compose PostgreSQL moved from 10B to 10C (the roadmap text said 10B; the 10B brief excluded Docker); `/health/ready` moved to 10C (needs the database); environment names are `development|test|staging|production` and the CORS variable is `FRONTEND_ORIGINS` (the 10A draft said `local` and `CORS_ALLOWED_ORIGINS`) — backend docs updated.
- **Known limitations:** Starlette 1.8's TestClient prefers `httpx2`; the suite keeps `httpx` (as specified) with a scoped warning filter — revisit when `httpx` support is removed. `DEBUG`/`ENVIRONMENT` are unprefixed environment variable names (per the 10A docs), so an unrelated shell `DEBUG` value that is not a boolean fails startup validation with a clear message.

## Phase 10C Result

Phase 10C — PostgreSQL / SQLAlchemy / Alembic Data Layer Foundation = **COMPLETE** (commit `d0c02dd`). Real PostgreSQL 17 (Docker Compose), synchronous SQLAlchemy 2.1, psycopg 3, Alembic 1.20. **No product CRUD/read/search/auth API, no frontend change, no frontend/npm dependency.**

- **Schema (`0001_initial_schema`, 15 tables):** `users`, `user_roles`, `auth_identities`, `professional_profiles`; `listings` + subtypes `business_profiles`, `property_profiles`, `tutor_profiles` (no provider subtype); Food as a Business vertical (`food_profiles`, `food_menu_items`); `categories` + `listing_categories`; `listing_status_history`; `saved_items`; `news_articles`. Authentication behavior is **not** implemented — only the relational schema.
- **Integrity in the database (tested on real PostgreSQL):** UUID keys; constrained values as `VARCHAR(32)` + named `CHECK` (not native enums); a Food profile cannot attach to a General business (composite FK) and a business cannot stop being Food while a Food profile exists; ≤ 8 menu items with unique positions; category slugs unique per module, a parent in the same module, no duplicate category or position on a listing, `position >= 1` (Food's 1..3 maximum is a service rule); one Saved row per `(user, listing)`; `(provider, provider_subject)` unique; history row consistency (creation has no previous status, the action fixes the resulting status, a rejection needs a ≥ 10-character reason); `revision >= 1`. Subtype↔kind, parent↔module and news↔`news`-module are also database-enforced (additive, see `docs/backend/DATA_MODEL.md` §14). Cross-row rules (at least one category, contiguous positions, module matching, the status state machine, quota) remain **service** rules by design — no triggers.
- **Infrastructure:** `app/db/` (declarative `Base` with a deterministic `pk_/fk_/uq_/ck_/ix_` naming convention, UUIDv4 ids, engine/session factory, `transaction()`), `app/models/`, `app/repositories/` (taxonomy, listings — add/query/flush only), `app/services/listing_creation.py` (proves the all-or-nothing multi-table create), `app/dependencies/db.py` (session per request, always closed), Alembic (`alembic.ini`, `alembic/env.py` reading `DATABASE_URL` from settings, no credentials in files).
- **Readiness:** `GET /api/v1/health/ready` runs `SELECT 1` (200, or a safe 503 that never names the host, URL or credentials); `/api/v1/health` stays liveness-only and 200 while the database is down — verified by stopping PostgreSQL under the running container and bringing it back.
- **Data:** reference taxonomy (39 categories from the real frontend sources, `python -m app.db.seed`, insert-only and idempotent) is separate from development fixtures (`python -m scripts.dev_fixtures`, name-based UUIDv5 ids, refuses `ENVIRONMENT=production`).
- **Docker:** `backend/Dockerfile` (single-stage slim, non-root, runtime dependencies only, liveness HEALTHCHECK) and `backend/compose.yaml` (`postgres:17-alpine`, named volume, healthcheck, loopback port **54329**, creates `b17_dev` and `b17_test`; optional `api` profile). Image built and run against the Compose database.
- **Tests:** 291 (125 database-free + 166 PostgreSQL) — constraints, Food integrity, taxonomy, history, Saved, News, transaction rollback, seeds/fixtures, migrations (fresh upgrade → downgrade → re-upgrade, `alembic check` drift, offline SQL), readiness, session lifecycle. **Test-database safety:** explicit `TEST_DATABASE_URL`, name must end in `_test`, local host only, different from `DATABASE_URL`, `current_database()` verified; unsafe URL fails loudly; no URL → skip locally, **fail in CI**; PostgreSQL only (never SQLite); per-test SAVEPOINT rollback.
- **CI:** `backend-ci.yml` now runs lint, format, mypy strict, `alembic upgrade head` on a fresh PostgreSQL service database, `alembic check`, the seed twice, `pytest` (PostgreSQL suite included), plus a Docker image build job. Path filter unchanged (`backend/**` + the workflow file).
- **Deferred on purpose:** `search_document`/`pg_trgm` (delivered in 10D), `service_requests`, `media_assets`, `listing_revisions`, any API beyond health. Open product questions (area model, contact channel, demo content in production, takedown semantics) remain in `docs/backend/DATA_MODEL.md` §13.

## Phase 10D Result

Phase 10D — Backend Read APIs = **COMPLETE** (commit `2e73ebf`). Public, read-only HTTP APIs on real PostgreSQL: `GET /api/v1/categories`, `/search`, `/search/suggestions`, `/listings/{id}`, `/news`, `/news/{id}`. **No writes, no auth/RBAC, no frontend change (`src/`, `e2e/`, `package*.json` untouched), no new dependency, no Redis/PostGIS/search engine.** The two LOW Search UX findings stay deferred.

- **Architecture:** Router → read service (`app/services/public_reads.py`) → repository (`app/repositories/{search,listing_reads,news,taxonomy}.py`) → SQLAlchemy → PostgreSQL. Explicit read schemas (`app/schemas/read.py`, never ORM objects), mappers in `app/services/read_mappers.py`, camelCase, null fields omitted, `PagedEnvelope` with `meta.total/limit/offset`, the 10B error envelope with `requestId`.
- **Search foundation (migration `0002`):** `pg_trgm`; `listings.search_document` (application-maintained by `SearchIndexer`, called from `ListingCreationService` in the same transaction); GIN trigram index; partial approved-area index. `python -m app.db.search_index rebuild|check`. Rebuild is a required release step after migrating a **populated** database (`alembic upgrade head` → `python -m app.db.search_index rebuild` → `check`; `DEPLOYMENT.md` §4.1) and is proven by an upgrade-path test from populated `0001` data.
- **Behavior:** case-insensitive substring search with deterministic title-first ranking, kind-aware composable filters that mirror `matchesFilters` (Food filters never match General businesses; closed-set filters such as `vertical`/`service` return 422 for unknown values instead of being ignored), bounded ranked de-duplicated suggestions, offset pagination (limit 12, max 50), and a fixed number of SQL statements per request (no N+1). Only approved listings / published news are public; hidden, unknown and malformed ids share one `404`. Differences from the frontend are listed in `docs/backend/READ_API_PARITY.md`.
- **Fixtures:** the deterministic fixed-UUIDv5 dev/test data grew to 15 listings (11 public, plus pending/rejected/archived/pending-Food records) and 3 news (2 published, 1 draft), all search documents indexed.
- **Tests:** 539 (126 database-free + 413 PostgreSQL): search (matching, ranking, scopes, every filter, composition, visibility, pagination, validation), suggestions, detail per kind, news, categories, search-document composition and staleness/reindex, indexes + `EXPLAIN`, statement-count (N+1) guards, migration `0002` (upgrade, downgrade, re-upgrade, drift, and a populated 0001 → 0002 upgrade with audit, rebuild and search), strict validation of closed-set filters. Fixture-heavy modules load the fixtures once per module and truncate afterwards.
- **Verified:** `ruff check`, `ruff format --check`, `mypy --strict app tests scripts`, `alembic upgrade head` + `alembic check`, `0002` downgrade → re-upgrade, seed twice, fixtures twice (idempotent; refuse production), Docker image build, Compose API + PostgreSQL readiness, manual endpoint smoke tests against the container.

## Phase 11A Result

Phase 11A — Authentication Security & Contract Freeze = **COMPLETE** (commit `3c10c1a`). **Architecture and security design only: no code, no migration, no dependency installed, no frontend change.** The authoritative document is `docs/backend/AUTH_RBAC.md` (rewritten); `API_CONTRACT.md`, `DATA_MODEL.md` §15, `BACKEND_ARCHITECTURE.md`, `DEPLOYMENT.md` §9, `ROADMAP.md` and `DECISIONS.md` were updated to match.

- **Sessions:** opaque server-side sessions in PostgreSQL (`auth_sessions`, SHA-256 of a 256-bit token), one `HttpOnly; Secure; SameSite=Lax` host-only cookie (`__Host-b17_session` in staging/production); idle 14 d / absolute 30 d, multiple devices (cap 10), admin recency 2 h / 12 h; no JWT, no refresh tokens, no Redis, no `localStorage`, no signing secret.
- **CSRF:** `SameSite=Lax` + mandatory exact `Origin` (+ `Sec-Fetch-Site` as defence in depth) + a stateless session-bound `X-CSRF-Token`; JSON bodies normally, multipart only on explicit upload endpoints without weaker protection; development topology `127.0.0.1:5173` ↔ `127.0.0.1:8000`; CORS credentials switched on in 11B with exact origins. Same-site frontend/API topology (custom domain) is a prerequisite.
- **Credentials:** Argon2id, length-based policy (10–128, denylist), email stored lower-cased with a DB CHECK, hash on `users`; verification/reset via one purpose-tagged hashed single-use token table, links carry the token in the URL fragment and are redeemed by `POST`; enumeration-resistant login/forgot, explicit registration conflict (documented).
- **OAuth:** backend-driven Google authorization-code + PKCE + state + nonce, flow state in PostgreSQL bound to the browser; identity key `(provider, sub)`; no automatic email linking (the only exception is the narrow, reviewer-approved claim of a never-verified, active account when Google asserts the email as verified); Facebook/Apple compatible via `auth_identities`.
- **Authorization:** Resident = every account, Professional = a profile row (capability), Admin = explicit out-of-band grant; central dependencies (`get_optional_user`, `get_current_user`, `require_verified_user`, `require_professional`, `require_admin`) + service-level ownership with 401/403/404 rules; unverified users may browse/save but not write listings or requests.
- **Schema plan:** migration `0003` (11B: users CHECKs, `auth_sessions`, `auth_tokens`, `auth_events`, `auth_rate_limits`) and `0004` (11C: `oauth_flows`, `UNIQUE(user_id, provider)`). Phasing: 11B email/password + sessions, 11C Google OAuth + hardening.
- **Conflicts resolved:** the 10A doc listed `provider_user_id` (the model correctly uses `provider_subject`); 10A deferred the session mechanism (now chosen); error names `authentication_required`/`permission_denied` were mapped onto the existing `unauthenticated`/`forbidden`; `GET /users/me` as identity source replaced by `GET /auth/me`; the stale "10D commit: pending" notes were corrected to `2e73ebf`.

## Phase 11B Result

Phase 11B — Email/Password Authentication + PostgreSQL Sessions + CSRF + RBAC Foundation = **COMPLETE** (commit `ea57a11`). Implements the Phase 11A design (`docs/backend/AUTH_RBAC.md`; as-built notes in §20). **No Google/OAuth, no account linking/claiming, no migration `0004`, no frontend change (`src/`, `e2e/`, `package*.json` untouched), no Redis/JWT/MFA.** Dependencies added: `argon2-cffi`, `email-validator` (runtime) only.

- **Endpoints (10):** `POST /api/v1/auth/register · login · logout · logout-all · verify-email · resend-verification · forgot-password · reset-password · change-password` and `GET /api/v1/auth/me`. All responses are `Cache-Control: no-store`; the raw session token exists only in the cookie; `csrfToken` (derived from it) is the only token in a body.
- **Sessions:** opaque 256-bit tokens, SHA-256 stored in `auth_sessions`; cookie `b17_session` (development) / `__Host-b17_session` (staging/production), `HttpOnly; SameSite=Lax; Path=/`, `Secure` when hosted (cannot be disabled), no `Domain`; idle 14 d (sliding, `last_seen` written ≤ every 5 min) / absolute 30 d; multi-device with an atomic cap of 10 (oldest revoked, audited); logout/logout-all/password reset/password change/role change/suspension all revoke server-side; a session whose account is not `active` is rejected immediately.
- **CSRF / CORS:** `AuthSecurityMiddleware` — mandatory exact `Origin` on unsafe requests, `Sec-Fetch-Site` defence in depth, session-derived `X-CSRF-Token` on cookie-authenticated mutations (pre-session endpoints exempt), JSON-only bodies on `/auth/`; `allow_credentials=True` with exact origins; `X-CSRF-Token` allowed.
- **Credentials:** Argon2id (centralised parameters, rehash on login, bounded concurrency, dummy verification for unknown/password-less accounts); length-based policy (10–128) with the offline SecLists top-10k denylist (NFKC + case-fold lookup, no network); email stored lower-cased (DB CHECK).
- **Tokens / flows:** one `auth_tokens` table (hashed, purpose-tagged, single-use with an atomic guarded consume, 24 h verification / 60 min reset); fragment links; neutral forgot-password; reset revokes all sessions and does not sign in; change-password rotates the current session and revokes the others.
- **Authorization:** `get_optional_user`, `get_current_user`, `require_verified_user`, `require_professional`, `require_admin` (verified + `admin` role + a session used within 2 h and created within 12 h; a refused stale request does not count as activity); Resident is implicit, Professional is a profile capability, Admin is an explicit `user_roles` row only grantable by `python -m app.cli.admin`.
- **Supporting:** `PostgresRateLimiter` (login failures 10/15 min, register 5/h, forgot 3/h, resend 1/min + 5/day), `auth_events` audit (allow-listed details), `EmailSender` (memory / console / disabled), `python -m app.cli.auth_maintenance purge`, uvicorn `--no-access-log` in the Docker image.
- **Migration `0003`:** `users` CHECKs (`email_normalized`, `email_length`) + `auth_sessions`, `auth_tokens`, `auth_events`, `auth_rate_limits`; upgrade, `0003 → 0002 → 0003` and drift verified.
- **Tests:** 848 (242 database-free + 606 PostgreSQL), including register/login/me/logout, sessions (idle/absolute/revoked/suspended/cap/ties), tokens (single-use, expiry, concurrency), CSRF/Origin/`Sec-Fetch-Site`, cookie flags (dev and hosted), enumeration, redaction, the authorization matrix via a test-only router, admin freshness, rate limiter, retention, CLIs, and concurrent logins/redemptions/grants on separate connections.
- **Verified:** ruff, ruff format, `mypy --strict app tests scripts`, `alembic upgrade head` + `alembic check`, Docker build, Compose API + PostgreSQL healthy, and a manual curl smoke test (register → cookie → me → CSRF rejection → logout → login → verify/reset via the dev console link → no secrets in the server log).
- **Production prerequisites unchanged:** a custom same-site domain and an email provider (delivery is `disabled` when hosted).

## Phase 11C Result

Phase 11C — Google OAuth + Account Linking + Authentication Hardening = **COMPLETE** (Phase 11C commit: pending). Implements `docs/backend/AUTH_RBAC.md` §10 as frozen (as-built notes in §21). **No frontend change (`src/`, `e2e/`, `package*.json` untouched), no Facebook/Apple/Instagram, no MFA/Redis/JWT/refresh tokens, no write API, no real email provider.** Dependencies: `pyjwt[crypto]` and `httpx` (now runtime). Authlib was evaluated and rejected (see `DECISIONS.md`). No Google SDK; no JWT/OIDC cryptography is hand-written.

- **Endpoints (3, `/api/v1/auth`):** `POST /oauth/google/start` (login: Origin; link: session + CSRF) → `{authorizationUrl}` + short-lived flow cookie; `GET /oauth/google/callback` → always a `302` to the configured frontend (`returnTo`, or `/login?error=<oauth_denied|oauth_failed|identity_conflict|email_not_verified|account_disabled>`); `DELETE /oauth/google` → `204` (never removes the last sign-in method).
- **Flow:** backend-driven authorization code + PKCE S256 + `state` + `nonce`; single-use `oauth_flows` row (hashed `state` and browser-binding cookie, 10 min) consumed by one guarded `UPDATE … RETURNING` committed before any provider I/O; ID token verified with PyJWT (RS256 only, Google JWKS cached, `iss`/`aud`/`exp`/`nonce`); Google tokens discarded; the result is the same PostgreSQL session + `HttpOnly` cookie + CSRF token as a password login (10-session cap included).
- **Linking rules:** identity key `(google, sub)`; Case A creates a Resident; B signs in by subject; **C1 never links by email**; C2 is the single narrow unverified-account claim (password cleared, sessions revoked, tokens retired, audited); C3/C4 refuse; D (Connect) requires the initiating session and never moves an identity between accounts.
- **Provider seam:** `OAuthProvider` interface with `GoogleOAuthProvider` and a development/test-only `FakeOAuthProvider` (refused in staging/production). Normal pytest, CI and Docker never contact Google. Settings: `GOOGLE_OAUTH_PROVIDER` (`disabled` default), `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` (`SecretStr`), `API_PUBLIC_BASE_URL`.
- **Migration `0004`:** `oauth_flows` + `uq_auth_identities_user_id_provider`; upgrade, `0004 → 0003 → 0004` and drift verified. `auth_maintenance purge` also removes flows expired > 1 day.
- **Final-review hardening:** an explicitly unsafe `returnTo` is `422 validation_error` (absent/blank → `/`); the ID-token checks are strict (single-string `aud`, required `iat`/`sub`/`email`, boolean `email_verified`, 30 s skew leeway) and an unknown `kid` refreshes the JWKS once; malformed key sets fail safely.
- **Tests:** 1141 (394 database-free + 747 PostgreSQL): redirect/PKCE/settings/fake/Google-adapter unit tests (signed RS256 tokens over a mock transport, no network), the OAuth HTTP matrix, DB constraints, single-use consumption, retention, and concurrency on committed rows.
- **Not performed:** a real-Google smoke test (needs Google Cloud credentials; checklist in `docs/backend/DEPLOYMENT.md` §10).
- **Production prerequisites unchanged:** a custom same-site domain, an email provider, edge rate limiting, and access-log query-string stripping on `/api/v1/auth/oauth/*`.

## Production V1 Direction

- Complete the frontend before the backend.
- Advanced search & discovery (filters, sort, pagination contract).
- Resident experience (profile, saved/favorites, request history, notifications UI shell).
- Professional Workspace (shared shell, profession-specific modules).
- Free/Premium foundation (capability model, no billing yet).
- Admin production UX (user management, verification, moderation history).
- Food & Dining Directory expansion (bounded frontend/product vertical on the existing Business Directory/search/listing/moderation patterns; no cart, ordering, delivery or payments).
- Performance/code splitting (route-level `React.lazy`) — done in Phase 9H.
- Mobile/PWA (manifest, service worker, installability) — done in Phase 9G.
- Notifications + trust/reviews UI shells.
- Accessibility/SEO/cleanup + final frontend QA — done in Phase 9J (cleanup items listed in the Phase 9J Result remain open).

## Known Technical Debt

- Route-level code splitting is done (Phase 9H); remaining performance debt: `motion` (≈255 kB) is on the initial path, and the many small shared chunks are unmerged.
- PWA is installable (Phase 9G) but untested on real devices; per-route titles / meta are done (Phase 9J) but server-rendered / pre-rendered previews, prefetching and any offline write strategy remain open.
- No notifications UI yet.
- Resident state (`residentStore`) has no stable user id to scope by — demo auth is name-only, so per-account scoping is not real; explicit Log Out (not reload) is the only privacy boundary today. Real account scoping belongs to the backend/API phase (Phase 12).
- Professional/listing ownership (Phase 9D) is also name-based (`submittedBy === user.name`) — same demo-auth limitation, not a new one. Real auth/ownership belongs to the backend phase.
- Archived listings have no unarchive action yet (one-way in Phase 9D).
- Business/Property listings don't produce service leads — no request-capture flow exists for those kinds yet, only Provider's Request Service does.
- `listingsStore` is still in-memory only (reset on reload) — unaffected by Phase 9D/9E; `residentStore` and `planStore` (Phase 9E) are the two `localStorage`-persisted stores.
- Minor cleanup noted in Phase 9D review, not yet actioned (the `routes.editListing` constant it also mentioned is now used by the SEO route table): `resubmitListing` has no store-level status guard (archived-listing protection lives only in `EditListingPage`'s UI).
- Plan (Phase 9E) is demo/local only, not tied to any real account — same name-based limitation as everything else in this prototype; a determined user can switch their own plan, which is the explicit point of the demo Upgrade toggle. Real plan/subscription state belongs to the backend phase.
- Frontend capability checks (Phase 9E) are UX only, not authorization/security — explicitly documented in `types/entitlements.ts`; the backend will be authoritative once it exists.
- No profession-specific Premium modules built yet (Tutor/Property/Salon, etc.) — `professional.modules` capability exists, reserved and unconsumed, for exactly this future use.
- Auth is demo-only (name string, no password, no persistence) — by design, not yet a gap to "fix," but must become real before any production launch. The real design is frozen in `docs/backend/AUTH_RBAC.md` (Phase 11A); implemented in Phase 11B (email/password) and 11C (Google), frontend integration Phase 12 (the route guards also need a *loading* state because auth will be asynchronous).
- A backend exists (Phase 10B–11C: liveness/readiness, a 20-table PostgreSQL schema with Alembic migrations `0001`–`0004`, reference seed, a tested data layer, public read/search APIs, and email/password plus Google authentication with PostgreSQL sessions) but there is no write API and the frontend does not call it (the Google endpoints exist but no SPA code uses them) — all frontend state is still static seed data + in-memory or `localStorage`-persisted Zustand.
- Automated tests exist since Phase 9M (see `TESTING.md` → Known gaps): Chromium-only E2E, no axe/Lighthouse, no real-device or visual-regression testing, several flows (Education/Tutor, News admin CRUD, Leads/Requests lifecycle, Premium toggle) not covered by E2E.
- Backend contract open questions (area normalization, General-business category taxonomy, listing contact channel, demo content in production, admin takedown semantics) are recorded in `docs/backend/DATA_MODEL.md` §13 and need product decisions before the write APIs (Phase 12).
- Lint baseline: 8 pre-existing warnings (6× `only-export-components` in shadcn-pattern files, 2× `set-state-in-effect`) — known, unchanged across many phases.
- (Closed in Phase 9L) the 19 orphaned images and the dead `/services/home-construction` route were removed; the `shadcn` package was audited and kept (see Phase 9L Result). `shadcn` still sits in `dependencies` although it is only needed at build time (`src/index.css` imports `shadcn/tailwind.css`); moving it to `devDependencies` was out of scope for the cleanup phase and is optional, zero-runtime-impact hygiene.
- No SPA-fallback hosting config (`vercel.json`/`netlify.toml`/`_redirects`) — will 404 on refresh/direct link on a real static host until added.
- `CategoryCard` and `NewsCard` still hand-roll their own card surface styling — not yet migrated to the shared `Card` primitive; candidates for a later visual phase. (`ListingSummaryCard` moved onto `Card` `workspace` in Visual V4.)
- `Card`'s `elevated` variant is defined (`docs/design/DESIGN_SYSTEM.md` §8) but has no consumer in production UI yet — `interactive` (V1), `featured` (V2) and `workspace` (V4) are in use.
- Status badges everywhere use the shared `StatusBadge` or the accessible `-text` status tokens (≥5.45:1), and the global focus ring was fixed in Visual V6 — no open color/focus-contrast debt is currently known.
- `FeaturedBadge` markup is duplicated between `ProviderCard`/`BusinessCard` and `src/components/detail/FeaturedBadge.tsx`.
- Business Directory image coverage is uneven — several business categories still fall back to the generic icon placeholder instead of a real photo.
- Home Hero quick-search chips are static curated strings (not derived from data) and could drift from the searchable data again; "Solar installer" already did once and became "Solar" in Visual V2.1.
- Search `updateParams` (Visual V2.1) assumes browser history / `createBrowserRouter`, and treats any REPLACE navigation into a mounted `/search` as its own write — no external REPLACE navigation exists today. Search suggestions are local-data only until a backend search service exists; the real iOS on-screen keyboard has not been physically tested.

## Do Not Build Yet

- Marketplace
- Pharmacy
- Pick & Drop
- Community Activities
- B-17 Vault
- Real payments
- Cart, online ordering and delivery logistics (explicitly outside the Food & Dining phase)
- Native Android/iOS apps
- Full production RBAC before the backend exists
- Speculative profession-specific modules without explicit approval

## Next Step

Phase 12 (write APIs + frontend integration, including the SPA side of Google sign-in: start, `/login?error=` handling, Connect/Disconnect — which must call `SearchIndexer` for every listing/category write) and 13 (media + deployment) per `ROADMAP.md` and `docs/backend/BACKEND_ARCHITECTURE.md` §12. The backend phases should also pick up what the frontend deliberately deferred: server-side / pre-rendered per-page metadata and link previews, a per-entity sitemap, structured data from real entity data, a real production URL (`VITE_SITE_URL`), persistent data / auth, real media storage and any offline write handling. Phases 9F (Admin Production UX) and 9I (Notifications + Trust/Reviews UI) remain product decisions. Store packaging, push notifications, sharing / deep links, ordering / payments and premium merchant tools stay out of scope until their roadmap phases.

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
