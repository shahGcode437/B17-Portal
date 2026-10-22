# B-17 Portal — Testing

Introduced in Phase 9M. Two layers, both deterministic and non-interactive:

| Layer | Tool | Where | Runs in |
|---|---|---|---|
| Unit + component | Vitest 5, jsdom, React Testing Library, user-event, jest-dom | `src/**/*.test.{ts,tsx}` (next to the code) | Node (jsdom) |
| Browser E2E | `@playwright/test` (Chromium) | `e2e/` | A real browser against the **production build** |

All of it is `devDependencies`. There is no Jest, Cypress, Selenium, Puppeteer or snapshot-testing library.

## Commands

| Command | What it does |
|---|---|
| `npm run test:run` (alias `npm test`) | All Vitest tests once (CI-safe, never watches). |
| `npm run test:watch` | Vitest in watch mode (local development only). |
| `npm run test:e2e` | Builds the app, serves it, runs every Playwright project. |
| `npm run test:e2e:headed` / `:ui` | Same, in a visible browser / the Playwright UI. |
| `npm run test:e2e:report` | Opens the last HTML report. |
| `npx playwright install chromium` | One-time browser download (CI uses `--with-deps`). |

Full gate (what CI runs): `npx tsc -b --force` → `npm run lint` → `npm run test:run` → `npm run build` → `npm run test:e2e`.

## Structure

```
src/**/*.test.ts(x)        unit + component tests, colocated with the code they cover
src/test/setup.ts          the single Vitest setup file (jest-dom, cleanup, matchMedia + scrollIntoView shims)
vitest.config.ts           merges vite.config.ts (same aliases/plugins) + test options
playwright.config.ts       projects, webServer, artifacts
e2e/*.spec.ts              desktop journeys
e2e/mobile/*.spec.ts       mobile-viewport specs      (project: mobile)
e2e/pwa/*.spec.ts          service-worker / offline   (project: pwa)
e2e/helpers/               shared helpers (readiness, in-app navigation, role flows, `authMock.ts` mock auth API, `test.ts` fixture)
tsconfig.e2e.json          type-checks e2e/ and playwright.config.ts under `tsc -b`
```

## Unit and component strategy

Unit tests cover pure logic with real inputs/outputs; component tests cover behavior through the accessibility tree.

- **Unit:** the read layer (adapters, read URLs, hooks — Phase 12G; the old local Search service was removed), Food config (derivation, validation helpers, labels), listing builders and schemas (general, Food, Property), SEO route/entity descriptors, store actions and selectors (listings, resident).
- **Component:** `SearchBar` (combobox), `FilterControls`, `FoodListingFields`, `ListingForm` (business-type switching, validation, prefill), the four result cards (`cards.a11y.test.tsx`: no nested interactive controls, tab order, Save independence), `useRequireOnline`, `InstallPrompt`, `RouteFallback`, `RouteError`, `PwaStatus`.
- Queries are `getByRole` / `getByLabelText` / `getByText`; no snapshots. Interaction uses `user-event`.
- **Auth tests (Phase 12C):** `src/test/apiMock.ts` (`installFetchMock` stubs `fetch` with the real `{data}` / `{error}` envelopes), `src/test/authFixtures.ts` (`testUser`, `authContextValue`), `AuthProvider.test.tsx` (state machine, stale answers, CSRF retry, session loss, no storage writes), `client.test.ts`, `safePath.test.ts`, `fragmentToken.test.ts`, `AuthGate.test.tsx`, the page/form tests, `fragmentBootstrap.test.ts` (the bootstrap is `main.tsx`'s first import; a router created afterwards sees a clean URL, one created without it would not), `persistedStoresAuthority.test.tsx` (the persisted demo stores hold no security state and feed no guard), `serviceWorkerApi.test.ts` (executes `pwa/sw.template.js` against a fake worker scope) and `authSafety.test.ts` (source audit: no auth data in `localStorage` / `sessionStorage` / `document.cookie` / Bearer). Nothing contacts Google or a real API.
- **Read-integration tests (Phase 12G):** `src/test/fixtures/apiFixtures.ts` holds deterministic backend-shaped payloads (all five listing kinds, Food as a vertical, exact / approximate / area-only locations, an inactive category, owner / admin / saved / request / lead data, and ONE place that states the private point and address so tests can prove they never leak); `readRouter.ts` answers every read endpoint from them as a pure function (filters, pagination, `404`, `401`, `403`); `fakeBackend.ts` adapts it to `installFetchMock`; `src/test/renderPage.tsx` renders a page inside a router + auth + toast context. Suites: `adapters.test.ts`, `reads/reads.test.ts` (URLs, encoding, credentials, error normalisation, invalid `meta`), `hooks/reads.hooks.test.tsx` (lifecycle, stale-answer suppression, abort, debounce, paging), `components/location/*` (fake engine for modes + a jsdom smoke of the real Leaflet engine that fails on any `fetch`), `features/detail.pages.test.tsx` (five kinds × three modes; `leafletEngine` is `vi.mock`ed to record what is drawn), `features/search/SearchPage.test.tsx`, `features/public.pages.test.tsx`, `features/private.pages.test.tsx`, `features/writes.deferred.test.tsx`, `features/noDemoLabel.test.tsx` (no "Demo" label on any real-API surface) and `architecture.test.ts` (source-level boundary audit, incl. no facet lookup from search results). `FilterControls.test.tsx` and `SearchPage.test.tsx` prove no Area / Grade dropdown is offered and that only the 12-hit results request reaches `/search`. A jsdom `IntersectionObserver` stub lives in `setup.ts`. Note: `SearchPage` writes params from the live `window.location`, which a `MemoryRouter` does not update, so `renderPage` syncs the jsdom URL once and multi-step URL flows are left to Playwright. Playwright treats `aria-disabled` controls as not actionable, so specs press the deliberately-unavailable Save control with `click({ force: true })` / `tap({ force: true })` (a real user can press it: it stays focusable).
- Zustand stores are module singletons: reset them in `beforeEach` (`useResidentStore.setState({ savedItems: [], requests: [] })`). The listing and news stores no longer exist (Phase 12G). `src/test/setup.ts` clears `localStorage` / `sessionStorage` and unmounts after every test.
- `src/pwa/install.ts` is also a singleton; `InstallPrompt.test.tsx` uses `vi.resetModules()` + dynamic imports for a fresh copy per test.
- A test probe that publishes React state to the test (e.g. a context `latest` ref) must do it in `useLayoutEffect`, not `useEffect`: a passive effect can run one tick AFTER the DOM that `waitFor` observes, so reading the ref right after `waitFor` is intermittently stale (this was a ~1-in-60 flake in `AuthProvider.test.tsx`). Do not import the whole app router in a test (a cold transform of the app can exceed the timeout on a loaded machine); test router behaviour with a small `createBrowserRouter`.
- Prefer `user.paste` over `user.type` for long text in forms — one event per field keeps suites fast on slow disks. `testTimeout` is 15 s as headroom for cold Windows / OneDrive starts (the first worker spin-up there can occasionally time out once; re-run).

## E2E strategy

### Server and `baseURL` (no `localhost`)

Playwright builds the app and serves it with `vite preview --host 127.0.0.1 --port 4173 --strictPort`; `baseURL` is `http://127.0.0.1:4173`. `localhost` is deliberately avoided: on Windows it can resolve to IPv6 (`::1`) in one process and IPv4 in another (the Vite dev server bound `[::1]` while the Playwright browser resolved IPv4 and was refused). An explicit IPv4 address behaves the same on Windows, macOS and CI. The production build is what is tested — it is also the only build that registers the service worker.

Locally an already-running server on the port is reused (`reuseExistingServer`); in CI it never is. CI sets `PW_SKIP_BUILD=1` because its build gate already produced `dist/`.

### Projects

| Project | Match | Device | Service worker |
|---|---|---|---|
| `desktop` | `e2e/*.spec.ts` | Desktop Chrome | **blocked** |
| `mobile` | `e2e/mobile/` | Pixel 7 (touch, mobile UA) | **blocked** |
| `pwa` | `e2e/pwa/` | Desktop Chrome | **allowed**, serial (1 worker) |

### Service-worker strategy

Caching would make functional tests order-dependent, so every functional project blocks service workers (`serviceWorkers: 'block'`). Only the dedicated `pwa` project allows them, and it covers: manifest + icons, `sw.js` served with substituted build id, registration and control, offline browsing of already-visited pages with the offline notice, data reads failing visibly offline (the API is network-only: an honest error, never cached data and never "not found"), the map-tile / API non-caching assertion (Cache Storage holds the shell and no tile or API URL), and recovery after reconnecting. **Not automated:** the browser/OS install dialog and `beforeinstallprompt` heuristics (browser UI). The install affordance logic is covered by component tests (`InstallPrompt.test.tsx`), and real-device install / iOS Add to Home Screen remain manual checks.

### Isolation

Every test gets a fresh browser context (empty `localStorage`, cookies, service workers) and the app's in-memory state resets on each full page load. There is **no** reset endpoint or test-only code in the shipped bundle and nothing is exposed on `window`.

Authentication is real from Phase 12C, but E2E runs the production build **without a backend**, so `e2e/helpers/authMock.ts` fakes `/api/v1/auth/*` — and, since Phase 12G, every READ endpoint from the shared `src/test/fixtures/readRouter.ts` plus the OpenStreetMap tile host (a 1×1 PNG; `tileRequests` records what the page asked for, so no spec ever contacts a live tile server) — with `page.route` (all specs import `test` / `expect` from `e2e/helpers/test.ts`, which installs it): a stateful server-side session that survives reloads, `/auth/me`, CSRF enforcement, the error envelope, and a fake Google consent route (no real Google, ever). Listing data is the mock's read fixtures; there are no write endpoints (Phase 12H), so the old cross-role create → moderate → publish lifecycle specs were removed in 12G. The Admin area has no public link, so `navigateInApp()` drives React Router with `history.pushState` + a `popstate` event (the same path Back/Forward takes) and then waits for the destination's `<h1>`. This is a test helper only.

### Readiness and waiting

No `waitForTimeout`, sleeps or fixed delays (enforced by review: `grep -rE "waitForTimeout|setTimeout|sleep\(" e2e` must be empty). Routes are lazy, so every page is considered ready when it shows exactly one `<h1>` (optionally with a given name) — `expectPage()`. After that, all waiting is Playwright's auto-waiting and web-first assertions (`expect(locator)…`, `expect.poll`). Locators are semantic (role / label / text).

### Coverage map

| Spec | Covers |
|---|---|
| `read-journeys` | Phase 12G: public read journey (Home → Search → preview → detail, API-only requests), landing → Search, News, detail failure ≠ not found; **map privacy** (exact pin + attribution + numbers-only directions + tile requests; approximate circle with no pin / address / directions; area-only with no map element, no Leaflet and no tile request; no owner-only address or point on any public page; accessibility: named group / controls, no keyboard trap, wheel not captured); authenticated read journey (Saved, requests + history, owner listings with the private location in the owner's preview, leads — and zero writes); admin read journey (dashboard counts, queue filter, read-only review, inactive categories — and zero writes) |
| `search` | URL as source of truth (direct URL, reload, Clear), suggestions combobox (ArrowDown/Enter/Escape/click), Food vs General and Food filters, an unknown service dropped / an unknown Food category as an honest empty result, empty state, a failing search with retry, no-nested-interactive card + keyboard, the honest "coming soon" Save |
| `guards` | Signed-out redirects with return-to; roles and the Professional capability come only from the (mock) backend; non-admin refused; no public link to Admin; Admin logout |
| `auth` | Anonymous bootstrap, login, reload restores the session, wrong password, logout revokes, protected-page round trip, register + resend + verify (fragment removed), reset password, Google start / return / error / disabled, admin-only access |
| `seo` | Titles, descriptions, robots (indexable / `noindex, follow` Search / `noindex, nofollow` private + 404), canonical, entity titles, `robots.txt`, manifest |
| `routes` | Direct load of every public route (one h1, no error state), unknown entities, 404, primary nav `aria-current`, Back/Forward |
| `mobile/mobile` | Bottom tab bar, no horizontal overflow (incl. detail pages with a map), Filters sheet + Food scope, touch preview / honest Save, Food detail, the map on a phone (fits, 44 px zoom and directions targets, attribution, the page still scrolls over the map) |
| `pwa/pwa` | See service-worker strategy |

### Failure artifacts

`screenshot: 'only-on-failure'`, `trace: 'on-first-retry'` (CI retries once), `video: 'off'` (traces are more useful and cheaper). Output goes to `test-results/` and `playwright-report/`, both gitignored, along with `.playwright-mcp/`, `blob-report/` and `playwright/.cache/`. CI uploads the report always and `test-results/` on failure.

## Backend tests (Phase 12D additions)

The backend suite is documented in `backend/README.md` (3176 tests: 1191 database-free, 1985 on real PostgreSQL). The Phase 12D write API adds: pure-logic unit tests (`tests/test_listing_state.py`, `tests/test_listing_write_schemas.py`), the OpenAPI surface test (`tests/api/test_write_openapi.py`), and PostgreSQL API tests per concern — profile, create, edit (incl. the moderation-bypass matrix), archive, owner reads, the security matrix, public discovery after writes — plus `tests/db/test_listing_write_concurrency.py`, which races real requests on separate connections over committed rows (same-revision edits, archive vs edit, narrowing vs material edit, concurrent profile `PUT`, quota under contention, rejected resubmissions). Removing both the row lock and the revision guard makes those tests fail (checked by hand). Two hygiene rules: tests must not depend on a developer's local `backend/.env` (`Settings(_env_file=None)`), and parametrised time-based fixtures must not assume a short run (a `+300 s` token claim evaluated at collection time went stale once the suite grew past five minutes).

### Phase 12E additions

Database-free: the pure rule modules (`tests/test_moderation_rules.py`, `tests/test_taxonomy_rules.py`), the admin request / response schemas (`tests/test_admin_schemas.py`) and the OpenAPI surface (`tests/api/test_admin_openapi.py` — exactly the eight frozen operations, no delete / module / role endpoint, no secret in any admin schema). PostgreSQL: queue and detail (`test_admin_queue_detail_api.py`), moderation (`test_admin_moderation_api.py`: transition matrix, revision, reason bounds, history, public visibility, takedown), taxonomy (`test_admin_taxonomy_api.py`: create / patch / reorder, hierarchy, active / inactive, reindex statement counts), the security matrix (`test_admin_security_api.py`: every actor × every operation, Origin / CSRF tampering, the 2 h / 12 h session boundaries) and concurrency (`test_admin_concurrency.py`). Notes: (1) *lock-protocol tests* hold the taxonomy advisory lock from a raw connection and assert which operations block and which do not — the rename-vs-listing-write race tests alone pass by luck even without the locks (found by mutation), so the protocol itself is asserted deterministically; (2) mutation checks were run by hand on the taxonomy locks and the revision guard (removing them makes the matching tests fail); (3) `age_history` re-dates history rows because `created_at` is the database `now()`, which is identical for every row inside one test transaction; (4) statement counting uses a SQLAlchemy `before_cursor_execute` listener to prove a rename reindexes with one batched statement and a no-op `PATCH` writes nothing.

### Phase 12F additions

Database-free: the state machine (`tests/test_request_rules.py` — every action × role × status against a literal table, the B-17 date boundaries), the schemas (`tests/test_request_schemas.py` — strict create body, empty action body, responses that cannot carry a secret) and the OpenAPI surface (`tests/api/test_requests_openapi.py` — exactly the eleven frozen operations, no payment / chat / notification / media path). PostgreSQL: `test_saved_api.py`; `test_service_request_create_api.py` (eligibility, 50+ validation cases, server-owned-field injection, the contact channel, rate limits, rollback); `test_service_request_lifecycle_api.py` (the 120-case actor × action × status matrix plus journeys); `test_service_request_reads_api.py` (lists, inbox, detail, concealment, query counts, a request outliving its listing); `test_service_request_security_api.py` (Origin / CSRF tampering on every new write, no public leakage, suspended accounts); `test_service_request_moderation_api.py` (Saved and requests through real Admin takedown / re-approval); `test_service_request_concurrency.py` (separate connections over committed rows); and the `0006` tests in `test_migrations.py`. Notes: (1) the concurrency suite is what found the session-level advisory-lock bug — a shared-session test can never see a lock that belongs to a pooled connection, so lock behaviour is tested only on separate connections, and `race()` fails a test whose request is stuck rather than hanging the run; (2) transitions are checked against an expectation table written in the test, not derived from the module; (3) history ordering relies on `clock_timestamp()` — tests that need rows in a known order depend on that rather than re-dating rows; (4) mutation checks were run by hand on the locks, the status guard, ownership, eligibility and the counters; (5) the 12F suites add several minutes to the PostgreSQL run (the matrix signs in several accounts per case).

## MCP-assisted QA

The Playwright **MCP** browser is an exploratory tool for a human-in-the-loop / agent review (visual checks, accessibility-tree inspection, "does this feel right") — it is **not** a test runner and nothing in CI depends on it. Findings that become regression risks are then encoded as Vitest/Playwright tests. The Phase 9M Search review is recorded in [`SEARCH_UX_FINDINGS.md`](SEARCH_UX_FINDINGS.md). Run it against the same production-style server on `127.0.0.1:4173` (never `localhost`) and delete any screenshots it writes into the repo (`.playwright-mcp/` is ignored; stray files elsewhere are not).

## CI

`.github/workflows/frontend-ci.yml` runs on push and pull request to `master`: `npm ci` → `tsc -b --force` → lint → Vitest → build → install Chromium → Playwright E2E, then uploads the report (and traces/screenshots on failure). No secrets, no deployment, read-only token.

## How to add tests

- **Pure logic** (service, builders, schemas, selectors): a colocated `*.test.ts` — assert real outputs, not implementation.
- **A component**: a colocated `*.test.tsx`; render with the providers it needs (`MemoryRouter`, `ToastContext`, auth context), query by role/label, assert what a user perceives. Reset any store it touches.
- **A bug**: write the failing test first (as done for the nested-interactive card bug), then fix.
- **A journey**: a `*.spec.ts` in `e2e/` (or `e2e/mobile`, `e2e/pwa`). Use `openApp(page, path, heading)` for full loads and `navigateInApp` only when state must survive. Never add sleeps; if something is not yet observable, assert on the thing the user will see.
- Keep selectors semantic. If you need a test id, that usually means the component is missing an accessible name — fix that instead.

## Known gaps

- Chromium only; no Firefox/WebKit/Safari runs, and no real iOS/Android device testing (the mobile project is an emulated Pixel 7).
- No automated axe/Lighthouse run; accessibility is covered by role-based assertions, the card a11y suite and manual review.
- No visual-regression screenshots (deliberately — they are brittle; visual checks are manual/MCP).
- Install dialog and iOS "Add to Home Screen" are manual.
- Not covered by E2E: Education/Tutor profile flows, News admin content CRUD, Leads (Professional) and resident Requests lifecycle, Free/Premium upgrade toggle. Their logic is partially covered at unit level.
- Auth is tested against a faithful mock of the API (Playwright) and a mocked `fetch` (Vitest); the real backend was exercised only by a manual smoke in Phase 12C. Real-service E2E (real database, real login) is the local real-stack lane added in Phase 12I (below). Real Google sign-in is a manual checklist (`DEPLOYMENT.md` §10).
- Phase 12G reads are tested against fixtures that mirror the real contract (and were checked against the real local API and its OpenAPI document by hand), not against the live backend; the real-stack run is the Phase 12I lane (below). There are no write tests on the frontend yet (12H).
- No automated axe run for the map or the new pages (role-based assertions and a manual 375 / 820 / 1440 px check were used); no real-device map testing; no live-tile test by design.

## Phase 12H additions (writes)

- **`src/test/fixtures/writeRouter.ts`** is a stateful, framework-free write server (revision concurrency on PATCH / approve / reject / archive, Saved idempotence, the request state machine, admin moderation, category create / patch / reorder) and enforces the real authority rules (e-mail verified → professional profile → `403 professional_profile_required`, Free quota, active category slugs per module, `422 validation_error` / `no_changes` for an unedited rejected resubmission). `e2e/helpers/authMock.ts` routes writes to it first and overrides the read router with the mutable state where a write must be visible on the next read (`/saved`, `/requests`, `/users/me/leads`, `/users/me/listings`, `/admin/listings`, `/admin/categories`, detail reads). State resets per test (`resetWriteState`).
- **`e2e/write-journeys.spec.ts`:** Saved round trip (save → Saved page → reload → unsave; no `localStorage` authority); admin approve; the five listing kinds through the real forms with captured request-body assertions (kind, `vertical: "food"`, no server-owned fields, area-only default, Property with the numeric map fallback and no `area_only` option); **the presentation-regression round trip** (owner creates → pending → admin queue → approve → public sees it → material edit → pending, revision bumped → admin rejects with a reason → owner sees it → resubmit → pending, reason gone → reload; `localStorage` holds nothing server-owned) plus focused edit journeys (approved edit, rejected edit, `no_changes`, stale 409) and the Professional-profile rule (a Resident is refused by the API and nothing is created; creating the profile then succeeds); request lifecycle (create → provider accept / start / complete → requester sees completed after re-login) and requester cancel; admin stale revision (a forced `409 listing_conflict` shows "changed since you opened it", the dialog stays open, a retry succeeds); category writes (create, rename, deactivate, reorder, reload); and a network failure on listing create (form kept, no success message).
- **Vitest:** `writes.test.ts` (every write module: URL, method, body, CSRF, id encoding, typed errors), `writeErrors.test.ts` (the real `no_changes` shape), `MapPicker.test.tsx` / `LocationFieldset.test.tsx` (fake picker engine: click, drag, numeric fallback, `area_only`, Property without `area_only`, no network), `useMutation.test.ts` (lifecycle, duplicate-click sharing, reset, non-`ApiError` → network error), updated page tests for Saved / listings / admin review / categories, and `architecture.test.ts` (writes only through `lib/api/writes`; no `residentStore` / `planStore`; no `persist(`).
- **Real-backend smoke** is a manual step before each write-phase commit (see CURRENT_STATE → Phase 12H Result); the full-stack run is the Phase 12I real-stack lane (below).

## Real-stack lane (Phase 12I)

`playwright.real.config.ts` + `e2e-real/` drive the REAL stack — the Vite dev server (`http://127.0.0.1:5173`) → FastAPI (`http://127.0.0.1:8000`) → PostgreSQL — with no mock backend. `127.0.0.1` for both, never `localhost` (same-site cookie). It is a **local acceptance lane, not part of CI** (see CURRENT_STATE → Phase 12I Result for why and the Phase 13 follow-up). Serial, single worker, desktop Chromium plus one 375 px mobile spec; map tiles are stubbed.

```bash
cd backend && docker compose up -d db                      # PostgreSQL (b17_dev); alembic upgrade head once
# API on the host, stdout kept in a file: the development e-mail console prints the verification links the lane reads
.venv/Scripts/uvicorn app.main:app --host 127.0.0.1 --port 8000 > ../api.log 2>&1
cd .. && B17_API_LOG=api.log npx playwright test -c playwright.real.config.ts    # starts / reuses `vite` on :5173
```

Needs: Docker (the lane asserts on PostgreSQL through `docker exec <container> psql`; `B17_DB_CONTAINER` default `b17-portal-db-1`, `B17_DB_NAME` default `b17_dev`) and `backend/.venv` (it grants the Admin role with `python -m app.cli.admin grant`). `P12I_KEEP=1` skips the teardown.

- **Data safety:** every account is `p12i.<label>.<run>@example.org` and every category / name carries `P12I-<run>`; global setup removes leftovers of a crashed run and global teardown deletes **only** what is reachable from that tag — users, profiles, listings and history, saved items, requests and history, categories, sessions / tokens and the hashed rate-limit counters — printing before / after counts and **failing if anything remains**. The seeded taxonomy is fingerprinted by the category spec and must be byte-identical afterwards.
- **Specs:** `01-auth` · `02-professional-and-create` (five kinds + pending invisibility) · `03-listing-lifecycle` (admin approve, material edit, `no_changes`, resubmit, privacy narrowing, stale owner / admin revision, archive, takedown, chronological history) · `04-location` (exact / approximate / area-only across DOM and network, private owner read, a real map click, round trips) · `05-saved-and-requests` (Saved, takedown, creation guards, lifecycle, cancel matrix, stale actions, race, survival, rate limits) · `06-categories` · `07-resilience` (CSRF / Origin, session expiry, login throttle, Free quota, network failure on every write, stale read) · `08-presentation` (the 22-step regression) · `09-public-reads` · `10-accessibility` · `mobile`.
- **Rules:** semantic locators; no fixed waits except to let an out-of-order response arrive on purpose; raw API calls (`ApiClient`) are only for set-up and for "someone else did this"; a UI assertion is backed by a PostgreSQL assertion wherever persistence is the point.
- **Known limits:** Chromium only; the accessibility checks are role / name / state assertions (no axe dependency); no real-device testing; live Google OAuth is not exercised.
