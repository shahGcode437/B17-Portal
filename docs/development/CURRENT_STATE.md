# B-17 Portal — Current Development State

## Last Updated

2026-10-03

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
FD3 commit: pending (implementation complete, review passed, not yet committed)

## Current Phase

Current Phase: FD4 — Listing / Professional / Admin Integration (next; not started — see `docs/product/FOOD_DINING.md`).
Food & Dining FD3 — Detail Experience: COMPLETE, reviewed (READY FOR COMMIT), commit pending approval. FD1 and FD2 are committed; the Visual Refresh sequence (V1–V6) is complete and committed.
Next Step: FD4.

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

Full history is in `git log`; this file summarizes outcomes, not the blow-by-blow.

## Current Architecture

- React 19 + TypeScript (strict) + Vite 8 SPA, no SSR.
- Three route trees under `createBrowserRouter`: `ConsumerLayout` (Header/Footer/MobileNav), `ProviderLayout` (now a full Professional Workspace shell — Overview/Listings/Leads/Profile nav, Phase 9D), `AdminLayout`. All routes are statically imported — no code splitting yet.
- `src/services/search.ts` is the single public read-data seam for all domain content (providers, businesses, tutors, properties, news, sponsored cards, plus category/subject/type tile enumeration, and — as of Visual V2.1 — `getSearchSuggestions` for predictive search). Components must not import `@/data/*` domain arrays directly — confirmed and enforced as of Phase 9A.
- Search/Explore state contract (Visual V2.1): URL = committed state (`q`/`type`/filters/sort); the input is a local draft of `q`; the suggestion list is transient local state. No global search store.
- Four Zustand stores: `listingsStore` (provider/business/property listing lifecycle: pending → approved/rejected, plus `archived` as of Phase 9D; `selectActiveListingsBySubmitter`/`isListingCountedTowardPlanLimit` added Phase 9E for the Free listing-limit check) and `newsStore` (draft/published) are in-memory only, reset on reload. `residentStore` (Phase 9C — saved items + request history; Phase 9D added `updateRequestStatus`) and `planStore` (Phase 9E — the mocked local Free/Premium plan) both persist to `localStorage` via Zustand's own `persist` middleware; both are cleared/reset on explicit resident Log Out (see Phase 9C/9E Results).
- Demo-only auth: `useAuth()`/`useAdminAuth()`, name-only sessions, no password, no backend. Already consumed only through their public hooks everywhere (verified in Phase 9A). `AuthProvider.logout()` also clears `residentStore` and resets `planStore` — see Phase 9C/9E Results.
- Free/Premium capability model (Phase 9E): `Plan → PlanEntitlements → Capability`, centralized in `types/entitlements.ts`/`config/plans.ts`, consumed only via `useCapability`/`usePlanEntitlements`/`<RequireCapability>` — never a scattered `plan === "premium"` check. Frontend-only UX gating, explicitly not a security boundary.
- Shared `Card` surface primitive (Visual Phase V1, `src/components/ui/card.tsx`) — presentation-only, variants `default`/`interactive`/`elevated`/`workspace`/`featured`; `ProviderCard`/`BusinessCard`/`TutorCard`/`PropertyCard` compose it instead of each owning its own surface classes. As of Visual Phase V2, `ProviderCard`/`BusinessCard` use the `featured` variant when the item's real `featured` seed field is `true`. `docs/design/DESIGN_SYSTEM.md` is the single visual-design source of truth going forward.
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
- No Food onboarding yet; preserving `FoodProfile` through create/edit/resubmit belongs to FD4 (the current `buildBusiness` creates general businesses and is not Food-safe).
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

Food & Dining FD3 — Detail Experience = **COMPLETE** (FD3 commit: pending). Source of truth: `docs/product/FOOD_DINING.md`. FD3 adds no route, no data model and no dependency.

- **Food sections live inside `BusinessProfilePage`:** composed conditionally for `vertical === "food"` through `FoodDetailSections`. `/businesses/:id` remains the only Food detail route — there is no `FoodDetailPage` and no `/food/:id`, so there is no duplicate route or detail architecture.
- **Presentation:** a Food & Dining badge; the primary category stays as the subtitle (`Business.category`) with other categories shown as "Also serves"; service options with an explicit "delivery arranged by the business — B-17 Portal does not currently provide delivery" clarification; a display-only hours note (no Open Now logic); informational menu highlights with optional section / description / price (demo values); an optional menu image. Each section is omitted when its data is absent.
- **Preserved:** the generic `BusinessCard` and the Saved architecture (`kind: "business"`) are unchanged; General Business details are unaffected; Search behavior is unchanged. The service-option icon map moved to a shared `src/features/food/foodIcons.ts`.
- **No transactions:** no ordering, cart, quantity, checkout, payment, rating, review or delivery-provider behavior was introduced.
- **Quality:** responsive (320 / 375 / 430 / 820 / 1024 / 1440) and accessibility checks passed (one h1, logical heading order, semantic lists, decorative icons hidden, visible focus); `npx tsc -b --force` clean; `npm run build` succeeds; lint at the established 8-warning baseline; fresh console 0 errors / 0 warnings; JS ≈ 871 KB; no automated test suite exists. Reviewed via `review-phase`: READY FOR COMMIT.

**Known limitations:** no permanent demo `menuImage` exists; hours are free text; the generic `BusinessCard` / Saved presentation remains; Food cannot yet be created or edited through onboarding.

**Known FD4 requirement:** the existing general Business builder (`buildBusiness`) is not Food-safe. FD4 must ensure `FoodProfile` survives **create, edit and resubmit**.

## Production V1 Direction

- Complete the frontend before the backend.
- Advanced search & discovery (filters, sort, pagination contract).
- Resident experience (profile, saved/favorites, request history, notifications UI shell).
- Professional Workspace (shared shell, profession-specific modules).
- Free/Premium foundation (capability model, no billing yet).
- Admin production UX (user management, verification, moderation history).
- Food & Dining Directory expansion (bounded frontend/product vertical on the existing Business Directory/search/listing/moderation patterns; no cart, ordering, delivery or payments).
- Performance/code splitting (route-level `React.lazy`).
- Mobile/PWA (manifest, service worker, installability).
- Notifications + trust/reviews UI shells.
- Accessibility/SEO/cleanup + final frontend QA.

## Known Technical Debt

- One large, eagerly-loaded JS bundle (~871 KB) — no route-level code splitting yet.
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

FD4 — Listing / Professional / Admin Integration: a Food & Dining choice in Business onboarding with `FoodListingFields` (1–3 categories, service options, hours note, menu highlights, optional menu image), validation/schema, Food support in `buildBusiness` (deriving `Business.category` from the primary Food category), edit prefill, preserving `FoodProfile` through create / edit / resubmit, Professional listing presentation as needed, and Admin Food metadata / review presentation (see `docs/product/FOOD_DINING.md` and `docs/development/ROADMAP.md`). Ordering, cart, checkout, commission, payments, merchant settlement, riders, platform delivery, reviews/ratings and backend work stay out of scope.

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
