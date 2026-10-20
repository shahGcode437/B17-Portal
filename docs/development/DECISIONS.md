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

**Decision:** PostgreSQL is the primary database; every externally visible resource uses a **UUID** primary key (generated by the application with the standard library's `uuid.uuid4()`; native `uuid` column — time-ordered UUIDv7 was an optional preference and is not used). Listings are **one `listings` base table plus shared-primary-key subtype tables** (`business_profiles`, `property_profiles`, `tutor_profiles`); a Provider has no subtype table until it has a real field. **Food remains a Business vertical**: `business_profiles.vertical = 'food'` plus `food_profiles` (tied to a food-vertical business by a composite foreign key) and `food_menu_items` (≤8, enforced by constraint) — never a listing kind.
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

---

**Decision:** Constrained value sets (listing kind/status, business vertical, category module, history action, roles, providers, plans, news kind/status…) are stored as **`VARCHAR(32)` + a named `CHECK` constraint**, not as native PostgreSQL `ENUM` types; Python code uses `StrEnum` types mapped by value. Every such column is `VARCHAR(32)` regardless of its longest current value.
**Reason:** the product evolves (new statuses, roles, category modules); changing a CHECK is an ordinary, reversible, transactional migration, whereas `ALTER TYPE … ADD VALUE` cannot be rolled back and has transaction restrictions. A uniform length means a longer future value never needs a column-type change.
**Revisit when:** a value set must carry per-value metadata (then a reference table), or PostgreSQL enum ergonomics clearly outweigh the migration friction.

---

**Decision:** The database enforces every integrity rule that is **row-local or expressible as a foreign key**, using composite keys where useful — subtype ↔ kind (`(listing_id, kind) → listings(id, kind)`), Food profile ↔ food-vertical business (the approved mechanism), category parent ↔ same module, news article ↔ `news`-module category — plus CHECKs, unique constraints and deliberate delete behavior (CASCADE only for data with no meaning without its parent; RESTRICT for ownership, audit history and categories in use). Rules that need a **cross-row, transactional view** stay in services and are tested against PostgreSQL: the status state machine, the **per-kind category count** (Food 1..3, every other kind exactly 1 — the generic `listing_categories` table carries only `position >= 1`, no maximum), contiguous category positions (a primary exists), category-module matching — each checked before writing and again by reading the stored rows back inside the transaction, so a violation rolls everything back — "a food business has a food profile", quota, and incrementing `revision`. **No triggers** implement business behavior.
**Reason:** database guarantees cannot be bypassed by a buggy or future code path; triggers hide workflow logic from application developers and make migrations harder to review.
**Revisit when:** a cross-row invariant proves repeatedly violated in practice (then a deferred constraint trigger for that one rule).

---

**Decision:** The backend test harness runs PostgreSQL-only integration tests under strict database safety: an explicit `TEST_DATABASE_URL` (never a fallback to `DATABASE_URL`), a database name ending in `_test`, a local host (`localhost`, `127.0.0.1`, `::1`, Compose `db`), a name different from the application database, and a post-connect `current_database()` check — otherwise the suite fails loudly. Without `TEST_DATABASE_URL` the database tests skip locally but **fail when `CI` is set**. Lifecycle: per session, reset `public`, `alembic upgrade head`, seed reference data; per test, a connection-level transaction with SAVEPOINTs rolled back at the end; migration tests use a throw-away scratch database. SQLite is never a substitute.
**Reason:** these tests drop a schema, so a typo must be physically unable to touch real data; the constraints under test (composite FKs, array CHECKs, partial behavior) are PostgreSQL behavior; migrations are exercised by the tests themselves; CI must never silently lose its database suite.
**Revisit when:** parallel test execution is wanted (per-worker databases) or the suite outgrows a single shared test database.

---

**Decision:** Phase 10C creates **only** the tables DATA_MODEL.md marks as current and defers the rest: `listings.search_document`, the `pg_trgm` extension and `GIN(tags)` ship with the Phase 10D search service that maintains them; `service_requests` (conceptual), `media_assets` (reserved), `listing_revisions` (content-version history) and a provider subtype table are not created. **Reference data** (the 39-category taxonomy from the real frontend sources) is loaded by an insert-only, idempotent seed in every environment; **development fixtures** (fake users/listings with name-based UUIDv5 ids) live in `backend/scripts/`, never in the application package, and refuse `ENVIRONMENT=production`. Production ids are random UUIDv4 from the standard library (no custom generator, no extra dependency).
**Reason:** a denormalized search column without its maintenance is worse than none; empty future tables mislead; admins' edits to categories must survive re-seeding; fixtures must never be shippable to production by accident.
**Revisit when:** 10D implements search, the request/lead or media phases start, or id index locality is shown to matter (switching to a time-ordered UUID is an application-only change).

---

**Decision:** Local/container operations: PostgreSQL runs from `backend/compose.yaml` (`postgres:17-alpine`, named volume, healthcheck, creates `b17_dev` and `b17_test`) on a **loopback-only host port 54329** so it never collides with a PostgreSQL installed on the machine; the API image is a single-stage `python:3.12-slim` build, non-root, runtime dependencies only (installed from `pyproject.toml` in a cached layer), defaulting to `ENVIRONMENT=production`, with migrations run as an explicit release step rather than on boot. `/api/v1/health` stays liveness-only (no dependency checks, 200 while the database is down); `/api/v1/health/ready` runs `SELECT 1` and answers a normalized `503 service_unavailable` that never reveals the host, URL or credentials.
**Reason:** orchestrators must distinguish "restart this process" (liveness) from "send traffic here" (readiness); a developer machine very commonly already runs PostgreSQL on 5432; running migrations on boot makes concurrent starts and rollbacks unsafe.
**Revisit when:** a multi-stage build or image-size budget is wanted, a platform requires a different probe path, or deployment hosting is chosen.

---

**Decision (Phase 10D):** Public search is a case-insensitive **substring** match over a maintained `listings.search_document` (lower-cased public text: title, category names, description, area, tags, Food menu-item names, property price/beds/furnishing/sale-or-rent, tutor grade), served by `pg_trgm` GIN. The document is **application-maintained through one `SearchIndexer`** called in the same transaction as every content change (no trigger, no generated column), with a staleness audit (`python -m app.db.search_index check`) and a rebuild (`… rebuild`, a required release step after migration `0002`). News documents are computed in the query. The migration is a new `0002`; `0001` is never edited.
**Reason:** a document spans several tables, which a generated column cannot express, and 10C chose services + constraints over trigger meshes; a single entry point plus an audit makes drift detectable and repairable instead of silent. Substring matching is exactly the frontend's behavior and `pg_trgm` makes it index-assisted at B-17's scale without a search engine.
**Revisit when:** search needs typo tolerance, stemming or distance (then Postgres full-text / trigram similarity / PostGIS), a write path appears that cannot reach `SearchIndexer`, or document maintenance cost shows up in profiling.

---

**Decision (Phase 10D):** Results are **ranked** when `q` is present — title exact, starts-with, word-prefix, contains, elsewhere, then shorter title, kind order, lower-cased title, id — and use a stable browse order (kind order, creation time, id) otherwise. This replaces the 10A draft's "no relevance ranking (matches the frontend)". Filters are **kind-aware** (copied from the frontend's `matchesFilters`: a filter narrows only kinds that have the field; Food-only filters exclude General businesses); finite-choice parameters (`type`, `sort`, `furnished`, `listingType`, `vertical`, `service`) are **validated** — absent = no filter, known = filter, unknown = `422` (the frontend ignored unknown Food values; ignoring would silently broaden a query) — while open data (`q`, `area`, slugs, `foodCategory`) is never rejected for being unknown; the `category` filter takes a **slug**, not a display label.
**Reason:** a real, multi-page result set needs a defensible order and total ordering for stable pagination; kind-aware filters preserve current user-visible behavior; slugs survive category renames.
**Revisit when:** product asks for different weights (e.g. featured boosting) or the frontend integration (Phase 12) shows a mismatch.

---

**Decision (Phase 10D):** Anything not publicly visible — pending, rejected, archived, draft, unknown or malformed id, or an id of the wrong resource — returns the **same `404 not_found`**; the read services build explicit read schemas (never ORM objects) and run a fixed number of SQL statements per request (eager loading, count + page in SQL), enforced by statement-count tests. Offset pagination (limit 12, max 50) with `meta.total`.
**Reason:** hiding moderation state prevents existence leaks; explicit schemas stop accidental exposure of private columns; the statement-count guard makes N+1 a test failure.
**Revisit when:** authenticated owner/admin read surfaces arrive (Phases 11–12) — those are separate endpoints, never a `status` filter on the public ones.

---

**Decision (Phase 11A — supersedes the 10A "token/session mechanism not chosen yet" note):** Browser authentication uses **opaque server-side sessions stored in PostgreSQL**, carried by a single `HttpOnly; Secure; SameSite=Lax`, host-only cookie (`__Host-b17_session` outside development). The cookie holds a 256-bit random token; only its SHA-256 is stored. Sessions are multi-device (cap 10), idle 14 days (sliding) / absolute 30 days, revocable at any time; admin actions additionally need a recent session (2 h idle / 12 h). No JWTs, refresh tokens, Redis, `localStorage` tokens, or signing secret.
**Reason:** a single modular monolith already queries PostgreSQL on every request, so stateless tokens add rotation/denylist complexity and slow revocation for no benefit; `HttpOnly` cookies keep tokens away from XSS; hashing the stored token means a database leak does not leak live sessions. A future native client can use an opaque bearer token backed by the same table.
**Revisit when:** native clients ship, the API must be called cross-site, or measured load makes the per-request lookup a bottleneck.

---

**Decision (Phase 11A):** CSRF protection is layered and central: `SameSite=Lax`, a mandatory exact `Origin` check on cookie-authenticated and pre-session unsafe requests (`Sec-Fetch-Site`, when present, must be same-origin/same-site — defence in depth only), a stateless **session-bound `X-CSRF-Token`** (HMAC of a constant with the session token as key, returned in the login/register/`me` bodies and held in memory) on authenticated unsafe requests, and `application/json` bodies for normal endpoints (explicit future upload endpoints may use `multipart/form-data` with no weaker protection). Development uses `http://127.0.0.1:5173` ↔ `http://127.0.0.1:8000` (never mixed with `localhost`). CORS credentials are enabled only with exact origins, in the change that ships the first cookie endpoint. The frontend and API must be **same-site** (preferred: `b17portal.pk` + `api.b17portal.pk`, or an `/api` reverse proxy); `SameSite=None` is not used.
**Reason:** cookie auth is CSRF-able; defence in depth survives any single layer failing; a derived token needs no storage or extra secret and resists cookie injection.
**Revisit when:** a cross-site deployment is forced, or a non-browser client needs to call state-changing endpoints with cookies.

---

**Decision (Phase 11A):** Credentials: **Argon2id** (`argon2-cffi`, central parameters, rehash on login, bounded concurrency); length-based password policy (10–128, common-password denylist, no composition rules); emails stored trimmed and lower-cased with a database CHECK (no dot/plus folding); the password hash stays on `users` (no credentials table, no usernames). Verification and reset use **one purpose-tagged `auth_tokens` table** with hashed, single-use (atomic consume), expiring (24 h / 60 min) tokens, delivered in the **URL fragment** and redeemed by `POST`. Password reset/change revoke sessions. Login, forgot-password and resend never reveal whether an email exists; **registration returns an explicit `409 email_already_registered`** (an intentional, rate-limited UX/security trade-off because registration signs the user in; `login`, `forgot-password` and `resend-verification` stay neutral). Verification/reset links keep the token in the URL fragment; the frontend must read it, remove it with `history.replaceState` before any third-party script runs, `POST` it, and never persist it.
**Reason:** memory-hard hashing, length over theatre, and one-time hashed tokens are current practice; fragments keep tokens out of logs and `Referer`; POST redemption survives email-scanner prefetch.
**Revisit when:** a breached-password API is adopted, hash parameters need retuning, or the registration UX changes to an email-first flow.

---

**Decision (Phase 11A):** Google OAuth is a backend-driven authorization-code flow with PKCE, `state` and `nonce`, flow state in PostgreSQL bound to the browser by a short-lived cookie, a server-stored relative `returnTo` (no open redirects), and Google tokens discarded after identity is established. Identity is `(provider, provider_subject)`, never the email. **Accounts are never linked automatically by email:** a verified existing account requires signing in and using *Connect Google*. The **only** email-match exception is the narrow *unverified-account claim* (account recovery / pre-hijacking defence), allowed only when the account exists with `email_verified_at IS NULL`, is `active`, Google explicitly asserts the same email as verified, and no conflicting provider identity exists; it links the identity, sets `email_verified_at`, clears `password_hash`, revokes all sessions, creates a new Google session and writes an audit event. Suspended, deleted, already-verified and identity-conflicting accounts are never claimed. A provider email is trusted only when the provider asserts it is verified. Facebook/Apple fit the same model; Instagram is not an identity provider.
**Reason:** email-based auto-linking is the classic takeover path; unverified accounts are the pre-hijack vector; keeping provider tokens out of the SPA avoids a new secret surface.
**Revisit when:** a second provider is added, a provider API (beyond identity) is needed, or the claim rule proves abusable.

---

**Decision (Phase 11A):** Authorization: **Resident** = every account (not stored), **Professional** = a `professional_profiles` row (a capability, not a role), **Admin** = an explicit `user_roles` row granted only out of band (CLI, audited, revokes sessions) — never from email, provider or client input. Authorization is centralized in dependencies (`get_optional_user`, `get_current_user`, `require_verified_user`, `require_professional`, `require_admin`) plus service-level ownership policies; frontend guards are UX only. `401` unauthenticated / `403` forbidden / `404` for resources the caller may not know exist. A verified email is required for listing writes and service requests; unverified users may browse, save and manage their account. Existing error codes `unauthenticated`/`forbidden` are kept; new codes are `invalid_credentials`, `session_expired`, `email_not_verified`, `account_disabled`, `csrf_failed`, `email_already_registered`, `identity_conflict`, `token_invalid`, `token_expired`.
**Reason:** one account and one login keep Resident/Professional/Admin coherent; central guards prevent scattered role checks; concealment avoids resource enumeration.
**Revisit when:** roles multiply (database-driven permissions), MFA/step-up is added to `require_admin`, or professional verification becomes a gate.

---

**Decision (Phase 11A — split approved in review; session cap frozen at 10 with oldest-first atomic revocation and an audit event, never rejecting a valid login):** Phase 11 is split: **11A** design freeze (docs only), **11B** email/password + sessions + CSRF + verification/reset + RBAC dependencies + audit + rate-limit seam (migration `0003`), **11C** Google OAuth + linking + hardening (migration `0004`). Abuse resistance uses **PostgreSQL** identity-keyed counters in the app and **edge** IP limits in deployment; no Redis and no in-process limiter.
**Reason:** OAuth is a separate, independently reviewable attack surface; an in-memory limiter is wrong with multiple workers; Redis is not justified by any current requirement.
**Revisit when:** measured auth load or abuse exceeds PostgreSQL counters.

---

**Decision (Phase 11B — implementation refinements of the 11A freeze):** (1) `change-password` answers `200` with the rotated session's me-shape and cookie (the new `csrfToken` has to reach the client), wrong current passwords share the login failure budget, and password-less accounts get `invalid_credentials`; (2) `resend-verification` stays authenticated + CSRF as frozen (the 11B brief had listed it among pre-session endpoints); (3) CSRF/Origin/content-type/no-store rules live in **one ASGI middleware** (`AuthSecurityMiddleware`) over the whole API prefix rather than per-route dependencies, with the five pre-session endpoints exempt from the token layer only; (4) an admin request refused as *stale* **restores** the session's previous `last_seen_at`, so the refused attempt does not count as activity; (5) the session cap locks the user row and revokes oldest-first (`created_at`, then `id`), auditing each; (6) the common-password denylist is the frozen **top-~10k offline corpus** — SecLists `10k-most-common.txt` (MIT, pinned commit, SHA-256 and license recorded in `app/core/security/data/README.md`), loaded from the package and normalized (NFKC + case-fold) on both sides — with an explicit note that only 51 of its entries reach the 10-character minimum; (7) the email backend is `memory` in tests, `console` in development and `disabled` when hosted (settings refuse console/memory there); (8) `last_seen_at` and all auth timestamps come from an injectable application clock. (9) **expired sessions have no retention guarantee**: login deletes the user's own expired rows, expired/revoked sessions never count toward the cap, and `auth_maintenance purge` is only a safety-net sweep (its 7-day threshold is not a promise); the durable security record is `auth_events`.
**Reason:** each is the smallest implementation that satisfies the frozen security intent; a central middleware cannot be forgotten by a future route; restoring `last_seen` closes a retry loophole in the admin-recency rule; the clock makes expiry testable.
**Revisit when:** the denylist is replaced or extended (a larger corpus, or a breached-password check), MFA/step-up is added to `require_admin`, or a non-browser client needs cookie-less access.

---

**Decision (Phase 11C — Google OAuth implementation choices):** (1) **Library: `PyJWT[crypto]` + `httpx`, no OIDC framework or Google SDK.** Authlib (the 11A preference) was tried and rejected: its `httpx` integration depends on a deprecated shim that trips `filterwarnings = error`, and it adds a second JOSE implementation (`joserfc`). PyJWT does the RS256 verification against Google's cached JWKS with an explicit algorithm allow-list; we write no JWT/OIDC cryptography. (2) **Provider seam:** `OAuthProvider` (build URL, exchange → validated identity) with a Google adapter and a `fake` provider that is development/test-only (settings refuse it when hosted), so normal pytest, CI and Docker never contact Google. (3) **Flow consumption** is one guarded `UPDATE … RETURNING` on `(state_hash, flow_cookie_hash, provider, unconsumed, unexpired)` committed *before* any provider I/O; a request that matches no flow does not consume the genuine one or clear its cookie (`flow_spent`). Resolution runs in one transaction with the user row locked and one retry on `IntegrityError`. (4) **Case A with an unverified Google email** creates the account unverified plus the normal verification email (the frozen §9 policy), never a verified one. (5) **`returnTo`** is validated at start (character class, length, no `//`/backslash/dot segments, no `/api`/`/admin/login`, re-checked after percent-decoding): absent or blank means `/`, but an explicitly supplied unsafe value is rejected with `422 validation_error` (final review: a malicious value must never be silently turned into a different destination, and no flow is created); the redirect origin is always `FRONTEND_BASE_URL`. (5a) **ID-token strictness:** a single-string `aud`, required `iat`/`exp`/`sub`/`email`, `email_verified` must be a real boolean, RS256 only from an allow-list (never the token's own `alg`), and an unknown `kid` refreshes the JWKS once (the `kid` always comes from a token Google just returned over the token endpoint, so it cannot be used to drive refreshes). (6) **No application-level OAuth rate limit:** the callback needs an unguessable, single-use, browser-bound `state`, `start` writes one small expiring row, and per-IP limits belong to the edge (the app still does not trust `X-Forwarded-For`). (7) **Disconnect never removes the last sign-in method** and never revokes sessions; **Connect never changes the account's email or password** and never moves an identity between accounts. (8) Migration `0004` adds `UNIQUE(user_id, provider)` and fails loudly on pre-existing duplicates rather than deleting data. (9) `httpx` moves from a dev to a runtime dependency; the client secret is a `SecretStr` and exists only in the environment.
**Reason:** the smallest set of well-maintained parts that keeps the frozen 11A security properties (no automatic email linking, no Google tokens kept, the existing session/CSRF model) and stays fully testable offline; choosing an unmaintained-shim framework would make the strict warning policy a liability.
**Revisit when:** a second provider (Facebook/Apple) is added, a native client needs a non-cookie token exchange, abuse of `start` is observed in production (add an edge or identity-keyed limit), or MFA/step-up is introduced.

---

**Decision (Phase 12A — location is a shared, first-class concern):** Location lives as columns on the shared `listings` row — `block`, `address`, `landmark`, `latitude`/`longitude` (`numeric(9,6)`), `location_visibility` (`exact|approximate|area_only`) and two **database-generated** public coordinates (`exact` → the point, `approximate` → `round(point, 2)`, `area_only` → none) — not duplicated per subtype and not in a side table. `area_only` stores no point at all (CHECK). Private columns are `deferred` and `raiseload`-ed in public reads; public schemas have no field for them; `search_document` carries `block` always and `address`/`landmark` only for `exact`. Requiredness depends on the kind (property: always a point; physical business: a point unless `area_only`; provider and tutor: default `area_only`). Approximation is **frozen at 2 decimal places** (`round(exact, 2)`, a ≈ 1.1 km grid; deterministic, never random), public behaviour uses the public generated columns only, and the map shows an *illustrative* circle labelled "Approximate location" with no privacy-radius claim. No PostGIS, no geocoding, no reverse geocoding, no geolocation in V1; map search and near-me use `public_*` only and can be added without schema redesign. Details: `docs/backend/LOCATION_MAP.md`.
**Reason:** hyperlocal discovery needs maps for every kind; one model gives one privacy rule and one serializer, avoids a join and N+1 on cards, and makes privacy enforceable in the database and the schemas instead of in the UI. The generated columns cannot drift from the exact point.
**Revisit when:** a listing needs several locations or service-area polygons (then a `listing_locations` table), approved listings reach the tens of thousands or radius queries get slow (PostGIS), or a deliberate new privacy decision changes the approximation (a new migration).

---

**Decision (Phase 12A — map stack):** Leaflet 1.9.x used directly through a thin wrapper behind a `MapEngine` interface, lazy-loaded; OpenStreetMap-compatible raster tiles supplied by configuration (`VITE_MAP_TILE_URL` / attribution). **`react-leaflet` is not used** — v5.0.0 is published under the Hippocratic-2.1 licence (ethical-source, not OSI-approved), which would need legal review for little benefit. No Google Maps JavaScript API. Public OSM tiles are for development and demo only; production uses a compliant provider chosen at deployment time (none is selected or priced now). The service worker keeps ignoring cross-origin requests so tiles are never cached. `Referrer-Policy: no-referrer` is applied to the verification / reset routes only, because OSM tiles require a referrer. **Get Directions** is an external `https://www.google.com/maps/dir/?api=1&destination=lat,lng` URL (no key), offered only for exact public locations. CI and tests never contact a tile server.
**Reason:** a few markers do not justify Google's billing and key management or a WebGL vector stack; a direct wrapper is small and licence-clean; configuration keeps the production tile decision open.
**Revisit when:** the `react-leaflet` licence is reviewed and accepted, traffic outgrows free tiles, or vector maps are wanted.

---

**Decision (Phase 12A — write lifecycle and contract):** Ownership is always derived from the session (`404` for non-owners); creating a professional profile and any listing or request write needs a verified email; saving does not. Every effective owner edit returns a listing to `pending` — **no non-material exemption** in V1 — except a **pure visibility narrowing** (`exact → approximate`, `exact → area_only`, `approximate → area_only`, with every other moderated value unchanged and only the technical point clearing for `area_only`), which applies immediately (`revision`++, no status change, no history row); any widening, or a narrowing combined with *any* other change, is an ordinary edit (`approved → pending`, one `resubmitted` history row). A rejected listing is resubmitted through `PATCH` with ≥ 1 effective change (no separate `resubmit` endpoint, no unedited resubmission); a no-op `PATCH` on other statuses is a `200` no-op. Admin `approved → rejected` takedown is kept (resolves O-5); admins cannot archive or edit others' listings. Concurrency uses the body `revision`: stale → `409 listing_conflict`, wrong status → `409 invalid_state_transition`; the UI never overwrites silently. Requests (provider listings only, verified requester, in-app status only) get their own migration `0006`; the requester may `cancel` while `submitted`/`accepted` (approved in the 12A review); the contact channel (O-3) must be resolved before 12F is finalised. Plan changes are out of scope (no billing), so the local Upgrade toggle cannot become real in Phase 12. Categories are admin-managed inside code-defined modules; `slug` and `module` are immutable. Details: `docs/backend/API_CONTRACT.md` §10.
**Reason:** one copy of content and no version history means a live edit would publish unreviewed text; a privacy-protective change must not take a listing offline for days; explicit codes let the UI behave correctly.
**Revisit when:** `listing_revisions` exists (then non-material edits can stay live), billing arrives, or admin request oversight is needed.

---

**Decision (Phase 12A — slicing and migrations):** Phase 12 is delivered as 12B (location foundation, `0005`) → 12C (frontend auth) → 12D (listing writes) → 12E (admin + taxonomy) → 12F (saved + requests, `0006`) → 12G (frontend read integration + map display) → 12H (frontend write integration) → 12I (full-stack E2E + closeout). The request tables move out of `0005` into `0006` so the location slice stays small and no unused table ships early. `leaflet` is added in 12G only, with explicit approval.
**Reason:** each slice is independently verifiable and committable; backend slices are not blocked by frontend work and the frontend only integrates APIs that already exist.
**Revisit when:** a slice outgrows a reviewable size (split it) or dependencies change.

---

**Decision (Phase 12A review amendments — legacy rows, areas, geofencing):** Migration `0005` is **purely additive and contains no data statement**: existing listings become a valid, documented legacy state (`location_visibility = 'area_only'`, no block / address / landmark / point, `area` untouched, `search_document` unchanged) and are shown area-level; no coordinate is guessed and no `area` text is parsed into `block`. A Property without a point survives (the database does not enforce per-kind requiredness), but any owner edit or resubmission must supply a valid location; archiving and admin moderation never validate location. For **new writes** `area` is the canonical locality (`B-17`, from the configured `LOCALITIES` list) and `block` is a separate free-text field. Fixtures receive explicit demo coordinates (and canonical `area` / `block`) through an idempotent fixture-loader step keyed by fixture ids — never by the migration — and some fixtures stay deliberately legacy to keep the transitional path tested. The legacy state needs no schema cleanup; the validated rule `ck_listings_property_has_point` may be added by a later migration once a drift query shows zero violations everywhere (never as `NOT VALID`, which would block moderating legacy rows). **No geofence:** only latitude `-90..90` and longitude `-180..180` are validated (no `LOCATION_COVERAGE_BBOX`, no null-island rule, no frontend bounds); B-17 validation waits for authoritative geographic data and is a recorded future enhancement.
**Reason:** a guessing migration would publish wrong locations or corrupt data; a transitional state that is valid, tested and invisible to the public is safer, and tying fixtures to explicit ids keeps demo data honest. Inventing a B-17 bounding box without authoritative data would be false precision.
**Revisit when:** authoritative geographic data exists (add geographic validation), the legacy drift query reaches zero (add the property rule), or a managed `areas` lookup replaces `LOCALITIES`.

---

**Decision (Phase 12B — how the location foundation is enforced in code):** (1) Private location columns (`latitude`, `longitude`, `address`, `landmark`) are `deferred` **with raiseload at mapper level** — secure by default; public repositories never load them and the public address / landmark are `with_expression` SQL fragments guarded by `visibility = 'exact'`, so non-exact private text is never even selected. (2) The generated-column SQL is written in PostgreSQL's normal form so Alembic's computed-column check stays silent (a project that runs warnings as errors would otherwise fail its drift test). (3) `SearchIndexer.refresh` re-reads through the indexing loader instead of trusting the caller's instance. (4) The public wire shape is the frozen nested `location` object, not a flat one. (5) Tests that stopped mid-history (0002) and then ran the application-level index CLI now upgrade to head first, since the CLI uses the current models.
**Reason:** make a privacy leak structurally hard (an exception, not a silent lazy load), keep the drift check meaningful, and keep the indexer correct whatever loaded the object.
**Revisit when:** a second code path needs the private columns (give it an explicit loader like the indexing one), or SQLAlchemy / Alembic change how computed columns are compared.

---

**Decision (Phase 12C — how the SPA holds authentication state):** (1) The auth state is `loading → anonymous | authenticated` plus a recoverable `unavailable`; guards never redirect while `loading`, and a failed bootstrap is retryable instead of being treated as a logout. (2) Every `/auth/me` answer is tagged with an epoch and a request sequence; an answer that is older than a state-changing action is ignored, and verify / reset / CSRF recovery ask for a *fresh* answer (`refreshMe({ fresh: true })`) instead of joining an in-flight request. (3) The CSRF token lives in module memory in `lib/api/session`, never in React state that is persisted, web storage or the service worker. (4) The one-time e-mail token is captured from the URL fragment by a tiny side-effect module that is the FIRST import of `main.tsx` (so it runs before the router — created at import time and reading the URL — and before App/PWA code), kept in module memory and stripped immediately; the Referrer-Policy for those routes is applied per route (`<meta name="referrer">` in the app, the real header at the host), not site-wide. (5) `/admin/login` is another screen over `/auth/login`; the admin role comes only from `/auth/me.roles`, and the Professional workspace is gated on the `/auth/me.professional` capability, shown as a "Professional profile needed" panel until 12D/12H provide onboarding. (6) Temporary, until 12F/12H make Saved / requests / plan backend-owned: user-scoped local demo state (Saved, requests, local plan) may survive an authenticated reload but is cleared on every CONFIRMED transition to anonymous (logout, definitive 401 including on the bootstrap read, `account_disabled`) and is left alone while the state is `unavailable` (network / 5xx). (7) The Google `authorizationUrl` is taken only from the typed start response, must be http(s), and is followed with `window.location.assign`; the callback's `?error=` is read from an allow-list and removed.
**Reason:** a refresh must not bounce a signed-in user; stale answers must not resurrect a logged-out or unverified state; nothing that proves identity may be reachable from storage, scripts or the service worker; and the frontend must never be the authority (the API re-enforces everything).
**Revisit when:** an account-security screen exists (add change-password / logout-all / Connect-Disconnect Google), the server sets a Referrer-Policy header per route, or the API moves to a different registrable domain (cookie topology, `AUTH_RBAC.md` §4).

---

**Decision (Phase 12D — how the owner write API realises the 12A freeze):** (1) A write is modelled as *old state → new state* in one pure module (`listing_state`): the request is applied to the stored state, normalised and compared; equality is "no change", and the *pure visibility narrowing* predicate is the only exemption from going back to moderation — the moderation decision lives in exactly one function, never in routers. (2) Concurrency is layered: the listing row is locked `FOR UPDATE` and the business `UPDATE` is guarded by `revision` as well, so removing either alone leaves the other as a safety net (both removed makes the concurrency tests fail). (3) Lock order stays profile → listing; an edit takes the profile lock only for a `rejected` listing, and if that is discovered after the listing row was locked the attempt is rolled back and repeated profile-first rather than inverting the order. (4) `archive` bumps `revision` like any other owner write; its history row carries the new revision. (5) Request bodies are strict through a wrapping validator (undeclared key → `not_allowed`, reported together with every other problem) instead of Pydantic's `extra="forbid"`, because the frozen error code is `not_allowed`. (6) Owner shapes echo the *write* vocabulary (category slugs) while public shapes keep the frontend's display values; they are separate schemas, repositories and mappers so the private location cannot reach a public response. (7) Only listing **create** is throttled (10 per user per hour — the one rate limit the freeze names); the counter is written after the commit and a request refused earlier does not use a slot. (8) `require_professional` now answers the frozen `professional_profile_required`. (9) Input-size bounds that were not frozen (tags 20 × 40, price 40, bedrooms ≤ 30, raw array caps, media reference ≤ 2048) were added purely as abuse limits and are listed in `API_CONTRACT.md` §11.
**Reason:** one place to reason about moderation, a lost update that is impossible by construction rather than by luck, no deadlock-prone lock inversion, and a private location that is structurally hard to leak.
**Revisit when:** a `listing_revisions` table exists (the "no non-material exemption" rule can then relax), edits or archives need throttling, or the owner vocabulary should match the public one for a generated client.

---

**Decision (Phase 12E — how admin moderation and taxonomy writes realise the 12A freeze without a migration):** (1) A moderation decision acts **on the reviewed revision and does not bump `revision`** (the frozen §10.4 rule): the row is locked `FOR UPDATE`, the body's `revision` and the expected status are checked, and a guarded `UPDATE … WHERE revision = :expected AND status = :from` applies it; an owner edit that commits first makes the decision stale (`409 listing_conflict`), one that commits second simply re-submits the listing — so an owner edit is never lost and an approval can never publish content the admin did not see. (2) Takedown is `approved → rejected` with the same history action `rejected` and a mandatory reason (trimmed, 10–500 characters); there is no separate takedown status or column, and nothing else (archived, same-state) is moderatable (`409 invalid_state_transition`). (3) The pending queue is oldest-first (`submitted_at` ascending); every other status is newest-first; `counts` always describe the whole queue. (4) Categories: `module` and `slug` are immutable and there is no delete (deactivate instead); names are unique per `(module, parent)` case-insensitively, enforced by the **service under a PostgreSQL transaction-scoped advisory lock** (exclusive for admin category writes, shared for owner listing create / edit, always taken first, before the profile and listing row locks) because the schema has no such constraint and migration `0006` is reserved; reorder renumbers the whole sibling group `1..n` and must name every sibling; a rename rebuilds the search document of every listing in the category in the same transaction. (5) An admin may moderate their own listing (no rule forbids it, history records the actor); granular admin roles stay deferred. (6) Admin authority comes only from `user_roles`, with the Phase 11 fresh-session rule (idle ≤ 2 h, age ≤ 12 h); `/admin/*` is `no-store`.
**Reason:** the revision rule was frozen, and a non-bumping decision is safe only if the lock protocol makes the two possible outcomes of every race consistent — which the deterministic lock-protocol tests and the SQL-level concurrency suite prove; the advisory lock gives uniqueness and rename-consistency with no schema change, so `0006` stays free for service requests; keeping slugs and modules immutable protects URLs, filters and the code-defined module set.
**Revisit when:** a `listing_revisions` table exists (decisions could then bump or pin a snapshot), a unique index on `(module, parent_id, lower(name))` is worth a migration (the advisory lock could then be dropped for names), a second admin tier or a "cannot moderate own listing" rule is wanted, or category deletion for unused categories is approved.


---

**Decision (Phase 12F — Service Request Contact Model V1, resolving open question O-3; set by the product owner):** (1) Service requests are created and tracked inside B-17 Portal and the B-17 request record is the source of truth. (2) WhatsApp and Phone are optional *preferred contact channels* only; the closed set is `in_app` (default) · `whatsapp` · `phone`. (3) There is **no** real-time or in-app chat, **no** WhatsApp API, SMS or calling integration, **no** notification, and **no** payment / Vault integration in 12F. (4) The preference is metadata on the request — choosing it sends nothing and starts nothing. (5) Provider contact information, when it exists, comes from trusted listing / profile data; requester contact data is never exposed outside the authorized request relationship. (6) Consequently no requester phone or e-mail field exists on a request (a future "requester contact" field needs its own decision), and listings still carry no contact data, so a `whatsapp` / `phone` preference tells the provider *how* the requester would like to be reached but 12F cannot yet deliver the number.
**Reason:** the product owner chose the smallest model that makes requests usable inside the portal without inventing delivery behaviour or storing personal contact data before the privacy and consent rules for it are designed.
**Revisit when:** listings or the requester get real contact data, a messaging channel (in-app chat or an external API) is approved, or notifications exist.

---

**Decision (Phase 12F — how Saved items and service requests realise the 12A freeze):** (1) The frozen paths and transitions were kept exactly (`/saved`, `/requests`, `/users/me/leads`; `in-progress` with a hyphen; the **provider may cancel in any non-terminal state, the requester only while `submitted` or `accepted`**) — where the phase brief assumed different names or a requester-only cancel, the frozen contract won. (2) **Authority is party membership, not a capability:** the requester, or the *current owner of the target listing*; the provider is derived and never stored as a user id; actions need neither a verified e-mail nor a professional profile, the inbox needs both. Refusal order: central CSRF/Origin → `401` → non-party `404` (indistinguishable from a missing request; no admin surface) → no authority over the action `403` → wrong status `409`. (3) **A request outlives its listing:** takedown, archive and owner edits never cancel, hide or alter an existing request, and its lifecycle actions do not look at the listing's status; only a *new* request needs the listing approved at that moment. (4) **Saved keeps the row and hides the listing:** a saved listing that stops being approved is absent from the list (even from the total) and returns if re-approved; it can be un-saved at any time, and cannot be saved again while down. (5) **Concurrency:** a transition = row lock + guarded `UPDATE … WHERE status = :from` + history; create = one transaction that first takes a *transaction-scoped* advisory lock per requester and counts the frozen rate limits (5/hour/user, 1/provider listing/day/user) inside the same transaction through a new non-committing `RateLimiter.record`, so the limits are exact under parallel creates and a failed request costs nothing. A session-level lock around separate transactions was tried and rejected (the pooled connection that held it was not the one that released it). (6) **History timestamps use `clock_timestamp()`**, not `now()`: `now()` is the transaction start, which under contention can precede the previous transition's and would mis-order the audit trail. (7) `preferredDate` means *today in B-17 (UTC+05:00)* or later and at most 365 days ahead (an abuse bound).
**Reason:** one place to reason about who may do what, a request record that stays truthful whatever happens to the listing, and concurrency guarantees that hold on real separate connections rather than only in a shared test session.
**Revisit when:** a requester-contact field or messaging is approved (O-3 follow-up), listings can be transferred between owners (the derived provider would change), an admin request surface is needed, or request creation moves to a queue with delivery.

---

**Decision (Phase 12G — Leaflet directly, behind a `MapEngine` boundary; `react-leaflet` not adopted):** (1) The map uses Leaflet through one file, `src/components/location/leafletEngine.ts`, which is the only importer of Leaflet; pages and components talk to the `MapEngine` interface (`mount(element, options) → { destroy }`). (2) `react-leaflet` is **not** used: the Phase 12A review chose not to adopt its Hippocratic-2.1 licence, and a thin imperative wrapper is ~60 lines. (3) The engine is loaded with a dynamic `import()` from `MapView`, so Leaflet (149.7 kB / 43.8 kB gzip + 15.1 kB CSS) is a chunk of its own, requested only by a detail page that actually draws a map; Home's initial JS is unchanged (≈ 623.6 kB). (4) The pin is a CSS `divIcon`, so Leaflet's default marker image URLs (which bundlers break) and any marker asset are avoided. (5) Approximate locations draw an **illustrative** circle (450 m) that makes no accuracy claim and is not derived from the hidden exact point; area-only and legacy locations render no map at all. (6) Directions are Google's documented `maps/dir/?api=1&destination=` URL built from numbers only, for exact public points only — no Google SDK, key, geocoding or geolocation. (7) Tiles are configuration (`VITE_MAP_TILE_URL` / `VITE_MAP_TILE_ATTRIBUTION`, OSM default for development); attribution is always shown; the service worker never caches tiles (cross-origin requests are ignored), as the OSM usage policy requires.
**Reason:** the smallest dependency surface that keeps the frozen privacy rules enforceable in one place, keeps the map library replaceable (a fake engine makes every map test deterministic and network-free), and keeps the initial load unchanged.
**Revisit when:** a production tile provider is chosen (config only), map search / near-me is approved (12A §14), or a second map library is evaluated.

---

**Decision (Phase 12G — read integration architecture):** (1) **No data library** (no TanStack Query): a small `useRead` / `usePagedRead` pair provides what the screens need — a key-derived lifecycle (`loading | success | error`), abort on key change, retry, `enabled`, and server pagination — and the shared categories / facet lookups are session-scoped caches that never remember a failure. (2) **Backend DTO → adapter → existing view model**: components keep their types; the adapters re-check the privacy invariants (`toPublicLocation`) so a misbehaving response cannot make an approximate or area-only listing look exact. (3) **Public and private DTOs live in separate files** and a source-level test fails if a public module imports a private one. (4) **No silent mock fallback:** the demo arrays and the old stores were deleted; a failed read is an error state with retry, an empty read is an empty state, a 404 (or a listing of another kind) is "not found". (5) **Totals are the server's** (`meta.total`); a list response without valid `meta` is a protocol error. (6) **Private reads wait for the auth bootstrap** and, for admin, the `admin` role; the route guards still own redirects. (7) **The URL is the search state**; typing is debounced into it and suggestions are server-side. (8) **The plan is server-owned** (`/auth/me` `professional.planCode`); the local plan store survives only for the demo Upgrade page until 12H. (9) **Area / Grade filters have no dropdown** (revised in the 12G review): their values are free text on listings, no endpoint or config enumerates them, and deriving options from one page of search results would silently omit legitimate values — so the controls are hidden rather than partially populated (a URL `area=` / `grade=` still filters and shows a chip). A backend facets endpoint is the future fix; it was not added in this frontend phase. (10) Every **mutation path is disabled, not mocked**: a control that cannot yet write says so (`aria-disabled`, "coming soon") and sends nothing.
**Reason:** the product's rule that an unfinished write must never look like it worked, plus the requirement that private data cannot reach a public surface by construction.
**Revisit when:** Phase 12H wires the writes (the disabled controls become real and the remaining local stores are removed), a facets endpoint exists, or request volume justifies a shared client cache.

---

**Decision (Phase 12G review — O-4: no "Demo" label on real listings):** A listing rendered from the real API is never labelled "Demo" or described as "prototype / demo details" anywhere (cards, quick look, detail, Saved, owner and admin surfaces, news). The frontend has no authority to say so: the API exposes no demo / seed flag, and demo status must not be inferred from an id, title, owner, route or environment. If demo listings ever need to be marked, the backend must expose an explicit flag first. Static, non-listing prototype copy (e.g. the site tagline) is unaffected.
**Reason:** a standing "Demo" badge on real data misleads users and hides the difference between seeded and real content.
**Revisit when:** the backend adds an explicit, trustworthy demo / seed flag.
