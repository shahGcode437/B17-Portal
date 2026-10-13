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

---

**Decision:** SEO is one dependency-free, client-side mechanism: a central config (`src/config/seo.ts`), one route-metadata table, entity descriptors published through `useSeo`, and a single writer (`SeoManager`, mounted in `RouteOutlet`) for `<head>`. No React Helmet. The production URL is never hard-coded: `VITE_SITE_URL` (else the page's own origin) feeds canonical / social URLs and the build-time sitemap, and `VITE_SITE_NOINDEX=true` forces `noindex` for staging / demo deployments.
**Reason:** one writer avoids conflicting tags and parent / child effect-order bugs; a table keeps titles and indexing rules reviewable in one place; the project has no final domain and all listing data is fictional demo content, so absolute URLs and indexing must be configuration, not code.
**Revisit when:** a production domain exists, real data replaces demo data, or per-page metadata must be present in the HTML a crawler / link-preview bot receives (pre-rendering / SSR / edge).

---

**Decision:** Index only the stable public discovery routes and the public detail pages; keep account, Professional, Admin, utility, Coming-Soon and 404 routes `noindex, nofollow` (indexing protection is the centralized page-level metadata only); keep `robots.txt` minimal (`Allow: /`, plus the conditional `Sitemap:` line) with no `Disallow`; keep `/search` `noindex, follow` with canonical `/search`; add no structured data and no per-entity sitemap until real entity data exists.
**Reason:** search / filter URLs are an effectively unlimited set of thin pages; a robots-disallowed URL cannot show its `noindex` / canonical, so any page that relies on `noindex` (including every private area and `/search`) must stay crawlable; robots.txt and `noindex` are crawl / index hints, not security. JSON-LD would need address / hours / ratings / authors that demo data does not honestly provide.
**Revisit when:** real, verified listings and a backend exist (then add a dynamic sitemap and structured data from real fields) or a measured need to index specific search landing pages appears.

---

**Decision:** Keep the `shadcn` package in `package.json` even though no source file imports it: `src/index.css` imports `shadcn/tailwind.css`, which defines the Tailwind custom variants (`data-open`, `data-closed`, `data-checked`, `data-vertical`, …) used by the generated `dialog`, `sheet` and `toggle-group` components. Unused-asset and unused-file cleanup is limited to items proven unreferenced (literal and dynamic paths, config, manifest, docs); generated-UI export surfaces are left intact.
**Reason:** removing it would silently drop those components' state styling; the package is build-time only (no JavaScript ships from it), so it is a hygiene question (`devDependencies` vs `dependencies`), not a runtime or bundle one.
**Revisit when:** the UI primitives stop using `shadcn/tailwind.css` variants, or dependency hygiene is revisited (moving it to `devDependencies` is the only change expected).

---

**Decision:** Browser E2E runs against the **production build** served by `vite preview` bound to explicit `127.0.0.1:4173` (`baseURL` the same), never `localhost`; functional Playwright projects block the service worker and only a dedicated serial `pwa` project allows it; tests get isolation from fresh browser contexts and the app's own in-memory reset on load — no reset endpoint, test-only flag or `window` hook is shipped. Flows that cross Professional/Admin roles use client-side navigation (`pushState` + `popstate`) in a test helper, because the in-memory sessions and listings must survive and the Admin area has no public link. No arbitrary waits; page readiness is "exactly one `<h1>`".
**Reason:** `localhost` can resolve to IPv6 in one process and IPv4 in another on Windows (the dev server bound `::1`, the browser used IPv4); the production build is what registers the service worker and what users get; a cached worker would make functional tests order-dependent; shipping test seams would be a permanent production risk; lazy routes make time-based waits flaky.
**Revisit when:** a backend exists (tests move to a seeded database / real auth and need a legitimate reset mechanism), more browsers/devices are added to CI, or the in-memory state is replaced.

---

**Decision:** Result cards are non-interactive surfaces with **one** stretched, named overlay button for the card action (`CardPreviewTrigger`, "Preview <name>") and independent Save / WhatsApp / Contact buttons layered above it; no interactive element is nested inside another. Cards without `onSelect` render no overlay.
**Reason:** a `role="button"` card containing buttons violates WCAG 4.1.2 and gives unreliable screen-reader and keyboard behavior; the stretched-button pattern keeps the full-card click target and the existing visuals without changing Search semantics. Framer Motion adds `tabindex="0"` to press-gesture elements, so the card container sets `tabIndex={-1}` explicitly.
**Revisit when:** a card gains a real per-entity link target — then the overlay should become an `<a>`.

---

**Decision:** The backend is a **modular monolith**: FastAPI + Pydantic v2 + **synchronous** SQLAlchemy 2.x + Alembic + PostgreSQL, REST under `/api/v1`, layered routers → services → repositories → models. Routers hold no SQL or business rules; **services own transactions** (commit/rollback) and repositories only flush; a service may call another module's service but never its repository. No microservices, Redis, queues or search engine.
**Reason:** one cohesive product with shared users/categories/transactions and a small team; every request is a few indexed SQL statements, so async adds complexity (session lifetimes, lazy loading, tests) for no measured benefit; the layer rules keep modules extractable and testable.
**Revisit when:** profiling shows threadpool saturation or a real async dependency appears; an independently scaling component emerges; a job proves too slow/unreliable in-process (then a queue).

---

**Decision:** PostgreSQL is the primary database; every externally visible resource uses a **UUID** primary key (generated by the application, time-ordered where available). Listings are **one `listings` base table plus shared-primary-key subtype tables** (`business_profiles`, `property_profiles`, `tutor_profiles`); a Provider has no subtype table until it has a real field. **Food remains a Business vertical**: `business_profiles.vertical = 'food'` plus `food_profiles` (tied to a food-vertical business by a composite foreign key) and `food_menu_items` (≤8, enforced by constraint) — never a listing kind.
**Reason:** the domain is relational and consistency-sensitive (ownership, moderation + history in one transaction, Saved/category relations, constraints as guarantees); a single base table gives one lifecycle/quota/Saved/moderation/search path for every kind while subtype tables keep real, typed, constrained columns (a giant nullable table, JSON blobs and per-kind lifecycles were rejected); UUIDs are safe in public URLs, don't leak counts and match the frontend's opaque-string ids.
**Revisit when:** a subtype needs independently-scaled storage, a kind needs a different lifecycle, or id ordering/size becomes a measured problem.

---

**Decision:** Taxonomy is **one `categories` table keyed by a code-defined `module`** (`services|directory|food|education|property|news`) with optional parent, active flag and display order; listings attach through `listing_categories` where **position 1 is the primary category** (max 3). A *category* is the primary classification users browse by within an existing module; a *module* is a product capability and is never created by an admin.
**Reason:** categories must be changeable without frontend releases, while a new module (Marketplace, Pharmacy…) needs product architecture, a subtype and lifecycle rules. Primary-by-position matches the frontend rule ("the first is primary") and avoids a second field that could disagree with the order.
**Revisit when:** categories need an order independent of primacy, or hierarchy depth becomes a product feature.

---

**Decision:** The listing lifecycle keeps the four statuses (`pending|approved|rejected|archived`; **no `draft` yet**) and is enforced as a backend state machine that is **stricter than the frontend UI**: owner create/edit/resubmit → `pending` (an edit takes an approved listing offline until re-approved, as today), admin approve/reject only from `pending` (reject also from `approved` as a takedown, reason ≥10 chars required), owner archive from any non-archived status, archived is terminal; everything else is `409 invalid_state_transition`. Every transition (including creation and `pending→pending` resubmission) writes an append-only `listing_status_history` row with an `action` column in the same transaction; the current rejection reason is derived from history (no duplicate column). Content edits increment `listings.revision` — an **integer concurrency/version counter that is a current requirement** — and moderation requests carry the reviewed `revision` so an admin can never approve content they did not see or overwrite a concurrent edit; full content-version history (snapshots) is a separate, deferred feature. Public reads return `approved` only (news: `published`) through one repository predicate.
**Reason:** preserves the behavior users know while closing latent looseness in the demo UI (admin could re-approve archived listings) and making moderation auditable and race-safe.
**Revisit when:** a `draft` state, unarchive, or content-version history / a "keep the old version live while a new one is reviewed" model (e.g. a `listing_revisions` snapshot table — distinct from the `revision` counter) is wanted.

---

**Decision:** API conventions: `/api/v1`; JSON and query parameters in **camelCase** (identical to the frontend types and the Search URL keys, so `URLSearchParams` forwards unchanged); responses **omit** absent optional fields (resolving the earlier null-vs-omitted decision), `PATCH` requests treat **omitted as unchanged** and **explicit `null` as clear — only for fields whose domain contract is nullable** (`null` on a non-clearable field is a `422`; arrays are replaced, not merged); `{data, meta}` success and `{error:{code,message,details,requestId}}` error envelopes with stable codes; **offset pagination** (`limit` default 12, `meta.total`); per-kind DTOs stay field-compatible with the current TypeScript domain types with additive fields; **state changes are action endpoints** and clients can never write `status`/`ownerId`/`featured`/`revision`; public browsing goes through `/search` (the seam `services/search.ts` was built for) rather than per-kind collections; hidden resources return 404, not 403.
**Reason:** zero mapping cost when Phase 12 swaps the mock seams; one vocabulary end to end; the UI shows totals ("N results") so cursors are unnecessary at this scale; transitions have side effects (history, quota, validation) so they are operations, not field writes.
**Revisit when:** a v2 breaking change is needed, an unbounded feed needs cursor pagination, or a non-search consumer needs a public listing collection.

---

**Decision:** Identity and roles: authentication (who) and authorization (what) are separate. **Resident** is the baseline of every signed-in account, **Professional** means a `professional_profiles` row exists (self-service, preserving today's "any signed-in user can list"), **Admin** is an explicit `user_roles` grant made only by backend/ops — never derived from an OAuth provider or email domain. Roles only add capabilities; public modules are never role-restricted. Social identities live in `auth_identities` keyed by `(provider, provider subject)` and link to an existing account only after the user proves control of it. The token/session mechanism is **not** chosen yet (Phase 11, after a security review); tokens are never kept in `localStorage`, and a same-site frontend/API topology is preferred.
**Reason:** the prototype's name-based demo auth must be replaced without restricting public browsing; silent email-based linking is the classic account-takeover path; the session choice depends on a security review and on future native clients.
**Revisit when:** roles multiply (database-driven permissions), native clients ship (Apple sign-in rules), or the hosting topology forces cross-site cookies.

---

**Decision:** Media is never stored in PostgreSQL: binaries go to **S3-compatible object storage** behind a small storage-backend interface (provider-neutral: S3, R2, Supabase Storage…), with a `media_assets` metadata table introduced in the media phase and URLs derived from a configured public base URL. A browser `blob:` URL is never accepted or stored; until the media phase the API accepts only public `https://` or site-relative image URLs.
**Reason:** blob URLs are session-local and meaningless server-side; keeping binaries out of the database keeps it small and fast, and provider neutrality avoids lock-in.
**Revisit when:** the media phase starts, or image processing/CDN transformations are needed.

---

**Decision:** Backend work is sequenced 10A (architecture, docs only) → 10B (FastAPI foundation) → 10C (PostgreSQL data layer) → 10D (read APIs) → 11 (auth/RBAC) → 12 (write APIs + frontend integration) → 13 (media + deployment). This replaces the earlier placeholders (old 10/11/12/13), pulling authentication into its own phase and putting the data layer ahead of any endpoint.
**Reason:** each phase is independently verifiable and committable; reads can ship and be integrated before the riskier write/auth paths; auth deserves its own security review.
**Revisit when:** the open product decisions in `docs/backend/DATA_MODEL.md` §13 force a different order.

---

**Decision:** Backend quality tooling is adopted from day one and enforced in CI: **pytest**, **ruff** (lint + format check, one tool, no Black/Flake8/isort) and **mypy in strict mode** (with the pydantic plugin), all configured in `backend/pyproject.toml`, with a separate `.github/workflows/backend-ci.yml` that only runs when `backend/**` changes. Dependencies are declared only in `pyproject.toml` (no `requirements.txt`), with tested lower bounds and a next-major upper bound. The app is built by `create_app(settings)` in `app/factory.py` with **no import-time side effects**; `app/main.py` is only the ASGI entry point, so tests always construct apps from explicit `Settings(_env_file=None, environment="test")` and never touch the developer's `.env`.
**Reason:** the frontend already enforces strict types and lint in CI; a small typed backend is cheapest to keep clean from the first commit; ruff covers lint/import-order/format in one fast tool; an import-side-effect-free factory is what makes the test environment genuinely isolated.
**Revisit when:** the suite or codebase grows enough that type-check time or rule noise matters, or a dependency (e.g. Starlette's `httpx2` migration) forces a test-client change.

---

**Decision:** Error handling is layered: `AppError` / `ErrorCode` and the envelope builder live in `core/errors.py`; FastAPI exception handlers (`api/error_handlers.py`) normalize `AppError`, HTTP errors (404/405/…), and request validation into the envelope using **fixed, safe messages** (never the framework's own text, the input value or pydantic internals; malformed JSON is `400 bad_request`, field errors are `422 validation_error` with `{field, code, message}` details); unexpected exceptions are caught by `RequestLogMiddleware`, which logs them once with the request ID and answers with the generic `internal_error` envelope — no traceback ever reaches a client. The request ID is a pure-ASGI middleware (valid incoming `X-Request-ID` kept, otherwise UUID4), every response and every error carries it, and each request writes one structured JSON log line (path only, never the query string, headers or bodies). Responses use a `ContractRoute` that always sets `exclude_none`, so the "omit absent optionals" contract cannot be forgotten per route.
**Reason:** one place decides what an error looks like, internals cannot leak, logs and responses can be correlated by one ID, and the null/omitted rule is enforced by construction instead of by convention.
**Revisit when:** an auth phase needs richer error headers, an error needs an `Idempotency`/retry hint, or tracing infrastructure replaces the home-grown request ID.

---

**Decision:** Settings are one typed Pydantic `Settings` source (`ENVIRONMENT` = `development|test|staging|production`, `DEBUG`, `APP_NAME`, `APP_VERSION`, `API_V1_PREFIX`, `FRONTEND_ORIGINS`, `LOG_LEVEL`), read from the environment and an optional git-ignored `.env`, with **no secret defaults**. CORS allows exactly the configured origins (comma-separated or JSON list; wildcards, paths and credentials in origins are rejected at startup), uses `allow_credentials=False` until Phase 11 decides cookie vs bearer auth, exposes `X-Request-ID`, and only the Vite dev origins are defaulted — and only in `development` when the variable is unset. Interactive docs and the OpenAPI document (`/docs`, `/redoc`, `/api/v1/openapi.json`) are published outside production only.
**Reason:** an implicit or wildcard origin in staging/production is a security defect; production should not advertise its API surface by default; credentials need exact origins and an auth decision that belongs to Phase 11.
**Revisit when:** Phase 11 enables cookie auth (credentials + exact origins), the API contract needs public OpenAPI for generated clients, or deployment needs finer docs access control.

---

**Decision:** Phase 10B stays limited to the application foundation. The API **Dockerfile and Compose PostgreSQL move to Phase 10C**, and **`/health/ready`** (database reachability) arrives with the database; the 10B health endpoint is liveness only and checks no dependency.
**Reason:** the 10B brief excluded Docker while the 10A roadmap text listed it for 10B; a Compose database and container image have no purpose until the data layer exists, and a readiness endpoint that cannot check anything would be misleading.
**Revisit when:** a deployment need (before the data layer) requires a container image earlier.
