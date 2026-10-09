# B-17 Portal — Architecture / Product Decision Log

Concise decisions only. Where the originating date isn't known, none is given rather than invented. Newest-relevant entries may be added at the bottom as they're made; do not reorder or delete past entries — add a new one if a decision changes.

---

**Decision:** Production frontend is completed before backend implementation begins.
**Reason:** avoids building backend infrastructure against a UI that's still changing shape.
**Revisit when:** Phase 9J (final frontend QA) completes.

---

**Decision:** PWA support comes before dedicated native apps.
**Reason:** one mobile-first, installable web app serves the near-term goal; native apps are a later, separate investment once the API exists for them to consume.
**Revisit when:** native app development is scheduled.

---

**Decision:** React + Vite frontend is retained for Production V1 (no framework migration).
**Reason:** the existing codebase is clean, consistent, and has no defects that would justify a rewrite; a migration would be pure risk with no product benefit right now.
**Revisit when:** a concrete requirement (e.g., SSR for SEO) can't be met within React + Vite.

---

**Decision:** Future backend direction is FastAPI + PostgreSQL.
**Reason:** product/team direction for Phase 10+.
**Revisit when:** Phase 10 begins, if requirements change.

---

**Decision:** `src/services/search.ts` is the public read-data seam for all dynamic domain content (providers, businesses, tutors, properties, news, sponsored, and category/subject/type enumerations).
**Reason:** established from early phases, reinforced and completed in Phase 9A; keeps the future mock→API swap contained to one file's internals.
**Revisit when:** if `search.ts` grows large/complex enough that per-domain modules would materially help — not before.

---

**Decision:** Static app configuration (`site.ts`, `serviceCategories.ts`, `discoveryCategories.ts`) may remain direct imports, distinct from dynamic listing data.
**Reason:** this is app copy/taxonomy, not paginated/queryable backend records — routing it through the data-access seam would be unnecessary abstraction.
**Revisit when:** any of these becomes genuinely dynamic/backend-driven content.

---

**Decision:** Zustand remains the client-state solution; no Redux/RTK migration.
**Reason:** current state needs (two small stores, no complex derived state) don't justify a heavier library.
**Revisit when:** state complexity genuinely outgrows Zustand — not anticipated in Phase 9.

---

**Decision:** Do not introduce TanStack Query (or any async data-fetching library) until a concrete async/API need justifies it.
**Reason:** avoid speculative infrastructure for an API that doesn't exist yet; adding it now would be premature.
**Revisit when:** Phase 12 (Frontend/API Integration) begins, or an earlier phase has a concrete, immediate async need.

---

**Decision:** TypeScript strict mode is enabled.
**Reason:** enabled in Phase 9A with zero resulting errors — the codebase was already written in a strict-safe style; keeping it off would have been pure risk for real API integration later, for no benefit.
**Revisit when:** not anticipated — this should stay on permanently.

---

**Decision:** One shared Professional Workspace is preferred over separate apps per profession (tutor, salon, property agent, service professional).
**Reason:** avoids building and maintaining N separate applications; profession-specific needs become modules/tabs inside one shell.
**Revisit when:** Phase 9D/9E, if a profession's needs turn out to be irreconcilable with a shared shell.

---

**Decision:** Premium/Free is modeled through capabilities/entitlements, not scattered `if (premium)` checks.
**Reason:** keeps gating logic centralized and swappable once a real entitlement source (backend) exists.
**Revisit when:** Phase 9E defines the actual capability model.

---

**Decision:** Billing/payment implementation is deferred.
**Reason:** out of scope for Production V1; no payment infrastructure exists or is being built yet.
**Revisit when:** a dedicated payments phase is explicitly scoped and approved.

---

**Decision:** Marketplace, Pharmacy, Pick & Drop, Community Activities, and B-17 Vault remain deferred ("Coming Soon" only).
**Reason:** explicit product scope boundary carried through every phase since the original prototype specification.
**Revisit when:** explicitly approved by the client/product owner.

---

**Decision:** The backend, when built, defines authoritative auth/RBAC/security — the current frontend demo auth is not a security boundary and must not be treated as one.
**Reason:** current auth is name-only, client-side, and trivially bypassable by design; this is acceptable pre-backend but must not carry forward as "real" security.
**Revisit when:** Phase 13 (Security/Auth/RBAC).

---

**Decision:** Third-party operational services (hosting, analytics, error tracking, etc.) stay separate from development code/scope unless a phase explicitly calls for integrating one.
**Reason:** avoid scope creep from tooling decisions that belong to deployment/ops, not frontend feature phases.
**Revisit when:** a specific phase requires a specific service.

---

**Decision:** The future API contract must explicitly decide the null-vs-omitted convention for optional fields (e.g., `image`) before real API integration.
**Reason:** identified in the Production V1 audit and Phase 9A — today's domain types use TypeScript optional (`?:`) fields, which don't model an explicit `null` a real API might return; changing this now would mean guessing an undefined contract.
**Revisit when:** the real API/DTO contract is defined (Phase 10/12) — normalize at the API-client boundary rather than changing domain types speculatively now.

---

**Decision:** One independently verifiable phase per commit.
**Reason:** keeps history bisectable and each change reviewable/revertable on its own; matches the established workflow across every phase so far.
**Revisit when:** not anticipated.

---

**Decision:** Food & Dining is implemented as a Business vertical (`Business.vertical` plus an optional nested `food` profile), not as a new domain, listing kind, Saved kind or Search result kind.
**Reason:** reuses the existing listing lifecycle, moderation, Professional Workspace, Saved items and search with no duplicate store or detail implementation; details in `docs/product/FOOD_DINING.md`.
**Revisit when:** a Food-specific capability (e.g. ordering) genuinely cannot be expressed on the Business model.

---

**Decision:** Route-level code splitting uses `React.lazy` for every page except `HomePage` and the tiny stubs, with the layout shells kept eager and a `Suspense` boundary (`RouteOutlet`) keyed by the matched route id inside each layout; no `manualChunks` / `codeSplitting` config and no prefetching.
**Reason:** a keyed boundary is required because React Router updates run in transitions (an unkeyed boundary would leave the old page frozen instead of showing the loading fallback), while keying by route id (not URL) preserves same-route behavior; Home and the shells stay eager to avoid a request waterfall on the landing screen; Rolldown's default splitting already removed the >500 kB chunk, so manual vendor chunks were not justified.
**Revisit when:** the initial path needs further trimming (e.g. `LazyMotion` for the 255 kB `motion` chunk), request counts from the many small shared chunks matter, or route prefetching / a bundle-size budget is adopted.

---

**Decision:** The PWA uses a hand-written service worker (`pwa/sw.template.js`) emitted by a small inline Vite plugin — no `vite-plugin-pwa` / Workbox dependency. It precaches only the app shell, caches `/assets/*` on first use, serves the cached shell for failed navigations, never touches other requests (no API / data caching), and updates only on the user's request (waiting worker + explicit Refresh). Install UI is a quiet in-flow strip (native `beforeinstallprompt` button on Chromium, manual Share guidance on iOS, hidden when standalone, 30-day local dismissal).
**Reason:** the need is small and fixed; a plugin would add a large dependency tree and Vite 8 / Rolldown compatibility risk, and a generic precache-everything default would defeat Phase 9H route splitting. Not caching data and not queuing writes avoids inventing backend semantics before a backend exists; user-triggered updates avoid surprise reloads or loops.
**Revisit when:** a backend / API exists (data caching, offline writes, push, Background Sync), the worker needs richer behavior (runtime strategies, prefetching, a precache manifest), or store packaging (Capacitor) starts.
