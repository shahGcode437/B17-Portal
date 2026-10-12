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
e2e/helpers/               shared helpers (readiness, in-app navigation, role flows)
tsconfig.e2e.json          type-checks e2e/ and playwright.config.ts under `tsc -b`
```

## Unit and component strategy

Unit tests cover pure logic with real inputs/outputs; component tests cover behavior through the accessibility tree.

- **Unit:** Search service (ranking, scope, Food vs General, filters, suggestions), Food config (derivation, validation helpers, labels), listing builders and schemas (general, Food, Property), SEO route/entity descriptors, store actions and selectors (listings, resident).
- **Component:** `SearchBar` (combobox), `FilterControls`, `FoodListingFields`, `ListingForm` (business-type switching, validation, prefill), the four result cards (`cards.a11y.test.tsx`: no nested interactive controls, tab order, Save independence), `useRequireOnline`, `InstallPrompt`, `RouteFallback`, `RouteError`, `PwaStatus`.
- Queries are `getByRole` / `getByLabelText` / `getByText`; no snapshots. Interaction uses `user-event`.
- Zustand stores are module singletons: reset them in `beforeEach` (`useListingsStore.setState({ listings: [] })`, `useResidentStore.setState({ savedItems: [], requests: [] })`). `src/test/setup.ts` clears `localStorage` / `sessionStorage` and unmounts after every test.
- `src/pwa/install.ts` is also a singleton; `InstallPrompt.test.tsx` uses `vi.resetModules()` + dynamic imports for a fresh copy per test.
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

Caching would make functional tests order-dependent, so every functional project blocks service workers (`serviceWorkers: 'block'`). Only the dedicated `pwa` project allows them, and it covers: manifest + icons, `sw.js` served with substituted build id, registration and control, offline browsing of already-visited pages with the offline notice, blocked mutations while offline (Request Service keeps its input), and recovery after reconnecting. **Not automated:** the browser/OS install dialog and `beforeinstallprompt` heuristics (browser UI). The install affordance logic is covered by component tests (`InstallPrompt.test.tsx`), and real-device install / iOS Add to Home Screen remain manual checks.

### Isolation

Every test gets a fresh browser context (empty `localStorage`, cookies, service workers) and the app's in-memory state resets on each full page load. There is **no** reset endpoint or test-only code in the shipped bundle and nothing is exposed on `window`.

Because listings and both login sessions are in memory *by design* (no backend yet), a flow that crosses roles — Professional → Admin → Professional — must not reload. The Admin area has no public link, so `navigateInApp()` drives React Router with `history.pushState` + a `popstate` event (the same path Back/Forward takes) and then waits for the destination's `<h1>`. This is a test helper only.

### Readiness and waiting

No `waitForTimeout`, sleeps or fixed delays (enforced by review: `grep -rE "waitForTimeout|setTimeout|sleep\(" e2e` must be empty). Routes are lazy, so every page is considered ready when it shows exactly one `<h1>` (optionally with a given name) — `expectPage()`. After that, all waiting is Playwright's auto-waiting and web-first assertions (`expect(locator)…`, `expect.poll`). Locators are semantic (role / label / text).

### Coverage map

| Spec | Covers |
|---|---|
| `save-journey` | Home → Search → preview → detail → logged-out Save → Log In → Save → Saved → unsave |
| `search` | URL as source of truth (direct URL, reload, Clear), suggestions combobox (ArrowDown/Enter/Escape/click), Food vs General and Food filters, unknown URL values, empty state, no-nested-interactive card + keyboard, Save vs preview |
| `food-lifecycle` | Professional creates a Food listing → validation → preview → submit → pending → Admin rejects with reason → Professional sees reason, edits (prefilled), resubmits → Admin approves → Search finds it → `/businesses/:id` shows Food data; plus a General business and a Service listing |
| `property-lifecycle` | Property create → submit → Admin approves → Search → `/properties/:id` |
| `guards` | Signed-out redirects for resident / Professional / Admin routes with return-to, role separation, no public link to Admin, Admin logout |
| `seo` | Titles, descriptions, robots (indexable / `noindex, follow` Search / `noindex, nofollow` private + 404), canonical, entity titles, `robots.txt`, manifest |
| `routes` | Direct load of every public route (one h1, no error state), unknown entities, 404, primary nav `aria-current`, Back/Forward |
| `mobile/mobile` | Bottom tab bar, no horizontal overflow, Filters sheet + Food scope, touch preview/Save, Food detail, Food listing form |
| `pwa/pwa` | See service-worker strategy |

### Failure artifacts

`screenshot: 'only-on-failure'`, `trace: 'on-first-retry'` (CI retries once), `video: 'off'` (traces are more useful and cheaper). Output goes to `test-results/` and `playwright-report/`, both gitignored, along with `.playwright-mcp/`, `blob-report/` and `playwright/.cache/`. CI uploads the report always and `test-results/` on failure.

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
- The suite tests demo guards and in-memory state; when the backend exists, auth/RBAC and persistence tests must be re-founded on real services (API contract tests, seeded database, real login).
