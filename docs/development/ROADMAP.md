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
**STATUS: NEXT**

- Objective: introduce a capability/entitlement model (frontend only, no billing).
- Major scope: `useCapability()`/`<RequireCapability>`-style gating mechanism, a mocked capability source, one real example profession module gated behind it (recommended: Education first, since it's the simplest data shape) — subject to client confirmation.
- Out of scope: billing, payment, real entitlement backend, generalizing to every profession at once.
- Dependencies: Phase 9D (workspace shell to plug the module into).
- Completion/verification: gating mechanism proven on one module; no premium UI appears for free users.

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
