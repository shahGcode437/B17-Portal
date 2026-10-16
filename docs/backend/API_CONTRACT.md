# B-17 Portal — API Contract

**Status:** conventions frozen by Phase 10A. **Individual endpoints are frozen only in principle** — the phase that implements each group owns its exact schema (§9). Once implemented, the generated **OpenAPI document is the machine-readable source of truth**; this file stays the human contract for conventions and intent. **Implemented so far:** `/health`, `/health/ready` (10B/10C) and the public **read** group — `/categories`, `/search`, `/search/suggestions`, `/listings/{id}`, `/news`, `/news/{id}` (Phase 10D; details in §6 and [`READ_API_PARITY.md`](READ_API_PARITY.md)). There are no write, auth or owner/admin endpoints yet. **The auth contract (cookie sessions, CSRF, error codes, endpoint list, `/auth/me` shape) is frozen by Phase 11A in [`AUTH_RBAC.md`](AUTH_RBAC.md) §5–§6 and §12 and is implemented in Phases 11B/11C.**
**Owns:** REST conventions, versioning, naming, response/error envelopes, pagination/filter/sort conventions, the planned resource groups and why they are shaped as they are.
**Does not own:** table design → [`DATA_MODEL.md`](DATA_MODEL.md) · role/permission rules → [`AUTH_RBAC.md`](AUTH_RBAC.md) · layering/CORS/logging → [`BACKEND_ARCHITECTURE.md`](BACKEND_ARCHITECTURE.md).

Design stance: **resource and business-operation APIs, not one endpoint per table**, and **contracts that let the existing frontend swap its mock seams** (`src/services/search.ts`, the Zustand stores) without reshaping its types.

## 1. Basics

- **Base path:** `/api/v1`. Breaking changes ship as `/api/v2` alongside; additive changes (new optional fields, new endpoints, new enum values clients must tolerate) stay in v1.
- **Format:** JSON (`application/json`, UTF-8). Timestamps are ISO 8601 UTC (`2026-09-08T10:00:00Z`); news `publishedAt` is a date (`2026-09-05`). IDs are UUID strings.
- **Naming:** JSON properties and query parameters are **camelCase**, identical to the frontend TypeScript types and to the public Search URL keys (`foodCategory`, `listingType`, `propertyType`, `serviceOptions`). Python/DB internals stay snake_case; Pydantic aliases translate. *(Older prose in `docs/product/FOOD_DINING.md` shows `food_category`; the shipped URL contract is `foodCategory`, so the API follows the URL contract — one vocabulary end to end, so `URLSearchParams` can be forwarded unchanged.)*
- **Optional fields — null vs omitted (resolves the open decision in `DECISIONS.md`):** responses **omit** optional keys that have no value (`image?`, `hoursNote?`, `featured?`), matching the frontend's `field?: T` types; in `PATCH` requests **omitted = unchanged** and **explicit `null` = clear** (only for fields whose domain contract allows it). Full rules and an example: *Null vs omitted* below.
- **Status codes:** 200 read/update, 201 create (+ `Location`), 204 delete/idempotent removal, 400 malformed, 401 unauthenticated, 403 forbidden, 404 not found, 409 conflict/invalid transition, 422 validation, 429 rate-limited, 500/503 server.
- **Hidden resources return 404, not 403:** a non-owner asking for someone's `pending` listing gets `404`, so existence is not leaked.
- **Request ID:** every response carries `X-Request-ID` (echoed or generated); error bodies repeat it.
- **Auth (decided in Phase 11A):** an opaque **server-side session carried by one `HttpOnly; SameSite=Lax` cookie** (`AUTH_RBAC.md` §4–§5); **no bearer tokens, no tokens in bodies or `localStorage`**. Cookie-authenticated unsafe requests (`POST/PUT/PATCH/DELETE`) must send an exact allowed `Origin` and carry `X-CSRF-Token` (`AUTH_RBAC.md` §6); request bodies are `application/json` except explicit future upload endpoints (`multipart/form-data`, equally protected); the SPA calls with `credentials: "include"`. Anonymous access is allowed for public reads. `Authorization` stays only as a reserved seam for a future native client.

### Null vs omitted — responses and partial updates

**Responses.** An optional field that has no value is **omitted** from the JSON (the default; `exclude_none` serialization), matching the frontend's `field?: T` types. A field the contract declares as always present is never omitted. Clients must treat "missing" and `null` identically when reading.

**Partial-update requests (`PATCH`).** Semantics follow the spirit of JSON Merge Patch (RFC 7396):

| Request body | Meaning |
|---|---|
| field **omitted** | leave the existing value **unchanged** |
| field `null` | **clear** the existing value — allowed **only** for fields whose domain contract declares them nullable/clearable |
| field with a value | set it (validated like a create) |

```jsonc
PATCH /api/v1/listings/{id}
{}                          // changes nothing about hoursNote (and nothing else)

PATCH /api/v1/listings/{id}
{ "food": { "hoursNote": null } }   // clears hoursNote
```

- `null` on a field that is **not** clearable (e.g. `name`, `area`, `kind`, `tags`) is rejected with `422 validation_error` (`code: "not_nullable"`); it is never silently ignored or treated as "unchanged".
- Which fields are clearable is declared **per field in the per-kind request schemas**, not guessed generically. Typical clearable optionals: `hoursNote`, `menuImage`/`image` (optional media references), Food menu-item `section`/`description`/`price`, `bedrooms`, `furnished`. Whether an owner may clear a `description` is a per-kind schema decision (curated Property rows may have none; user-submitted listings require 20–400 characters).
- **Arrays and nested sets are replaced, not merged:** an omitted `tags`/`food.categories`/`food.menuHighlights` is unchanged; a provided array replaces the whole set (the frontend edit form already resubmits the full set, and menu items have no stable ids). An explicit empty array clears only where the minimum cardinality allows it (e.g. `menuHighlights: []` is valid; `food.categories: []` is not).
- Server-owned fields (`id`, `status`, `ownerId`, `featured`, `revision`, `submittedAt`) are never accepted from a client, whether omitted, `null` or set.
- The same rule applies to every future `PATCH` (profile, news, categories, requests).

## 2. Success envelope

```json
{ "data": { "…": "resource or array" }, "meta": { "…": "optional" } }
```

- Single resource: `data` is the object, `meta` omitted.
- Lists: `data` is an array; `meta` carries pagination (§4).
- Actions (e.g. approve): `data` is the updated resource.
- `204` has no body.

**Resource shape compatibility (important):** per-kind JSON is **field-compatible with the current TypeScript domain types** (`Provider`, `Business`, `Tutor`, `Property`, `NewsArticle`) so existing cards, mappers and Search keep working — including the frontend's own inconsistency that `Provider.category` is a *slug* with a separate `categoryLabel`, while `Business.category` is a *label*. The API **adds** normalized, additive fields rather than changing these: `kind`, `categories: [{slug, name, isPrimary}]`, `status`/`submittedAt` (owner/admin views only), `createdAt`, `updatedAt`. Example (Food business, public detail):

```json
{
  "data": {
    "kind": "business",
    "id": "0b7a…",
    "name": "Capital Bakers",
    "vertical": "food",
    "category": "Bakeries",
    "categories": [
      { "slug": "bakeries", "name": "Bakeries", "isPrimary": true },
      { "slug": "cafes", "name": "Cafes", "isPrimary": false }
    ],
    "description": "Fresh bread, cakes and savouries baked daily.",
    "area": "B-17, Block C (Demo Area)",
    "image": "/images/…",
    "tags": ["bakery", "cakes"],
    "featured": true,
    "food": {
      "categories": ["bakeries", "cafes"],
      "serviceOptions": ["takeaway", "delivery"],
      "hoursNote": "Daily, 8 AM–10 PM",
      "menuHighlights": [
        { "id": "…", "name": "Chocolate Fudge Cake", "section": "Cakes", "price": "PKR 1,800" }
      ]
    }
  }
}
```

Food remains **`kind: "business"` + `vertical: "food"`** in every payload and query; there is no `food` kind, endpoint family, or Saved kind.

## 3. Error envelope

One shape for every non-2xx response:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Some fields are invalid.",
    "details": [
      { "field": "food.categories", "code": "too_many", "message": "Choose up to 3 categories." }
    ],
    "requestId": "7f3c…"
  }
}
```

- `code` is a stable, machine-readable string clients branch on; `message` is human-readable and safe to show; `details` is optional, structured and field-addressed (paths use the camelCase JSON names so they line up with form fields).
- **Never exposed:** stack traces, SQL/driver errors, exception class names, file paths, internal ids of other users. Unexpected errors are logged server-side with the request ID and returned as `internal_error` with a generic message.
- **FastAPI/Pydantic:** the default `422 {"detail": […]}` is normalized by one exception handler into the envelope above (`validation_error`); no per-route special cases.

| HTTP | `code` | When |
|---|---|---|
| 400 | `bad_request` | Malformed JSON/params |
| 401 | `unauthenticated` | Missing/invalid/expired credentials |
| 403 | `forbidden` | Authenticated but not allowed |
| 403 | `plan_limit_reached` | Active-listing quota exceeded (Free plan) |
| 404 | `not_found` | Unknown **or not visible to the caller** |
| 405 | `method_not_allowed` | Known path, unsupported method (keeps the `Allow` header) |
| 409 | `conflict` | Duplicate slug, concurrent modification |
| 409 | `invalid_state_transition` | e.g. approving a non-pending listing; stale `revision` |
| 422 | `validation_error` | Schema/business-validation failure |
| 401 | `session_expired` | A session existed but is expired/revoked (cookie cleared); *Phase 11* |
| 401 | `invalid_credentials` | Login failed — one fixed message for every cause; *Phase 11* |
| 403 | `email_not_verified` | A verified email is required for this action; *Phase 11* |
| 403 | `account_disabled` | Correct credentials on a suspended account; *Phase 11* |
| 403 | `csrf_failed` | Missing/invalid CSRF token or disallowed Origin; *Phase 11* |
| 409 | `email_already_registered` | Registration with an existing email (documented enumeration trade-off); *Phase 11* |
| 409 | `identity_conflict` | A social identity belongs to another account / email collision; *Phase 11C* |
| 400 | `token_invalid` · `token_expired` | Verification/reset token unknown, used or past its expiry; *Phase 11* |
| 429 | `rate_limited` | With `Retry-After` |
| 500 | `internal_error` | Unexpected |
| 503 | `service_unavailable` | Dependency down (e.g. DB) |

Validation messages in the frontend are authored client-side; the API returns codes + English fallback messages, and the frontend keeps owning UX copy.

## 4. Pagination, filtering, sorting, search

**Pagination: `limit` + `offset`**, with a total in `meta`:

```json
"meta": { "total": 37, "limit": 12, "offset": 0 }
```

Default `limit` **12** (the frontend's `PAGE_SIZE`), maximum 50. *Why offset, not cursor:* the UI shows "N results" and "Load More" — it needs a total, and at B-17's scale offset is cheap and simple. Cursor pagination is reserved for unbounded feeds/history (e.g. status history, future activity) where a total is not needed.

**Filtering:** query parameters, **named exactly like the frontend's Search URL keys**, so the existing URL state can be forwarded:

| Param | Applies to | Notes |
|---|---|---|
| `q` | all | Case-insensitive **substring** over title/subtitle/description/area/tags/(Food category names + menu item names) — frontend semantics preserved |
| `type` | all | `all` (default) · `provider` · `business` · `tutor` · `property` · `news` |
| `area` | all kinds with area | exact match |
| `category` | provider/business/news/… | **category slug** (the frontend currently passes a *label* for business/news; moves to slugs with the taxonomy — a Phase 12 frontend change) |
| `subject`, `grade` | tutor | `subject` = category slug |
| `listingType`, `propertyType`, `bedrooms` (= minimum), `furnished` | property | `propertyType` = category slug |
| `vertical`, `service` | business / business (Food) | **closed sets** — `vertical` ∈ `general · food`, `service` ∈ `dine-in · takeaway · delivery`; an unknown value is a `422 validation_error`, never ignored (an ignored value would silently broaden the query) |
| `foodCategory` | business (Food) | a category **slug** from the admin-managed taxonomy (open data): an unknown slug is a normal filter that matches nothing |
| `sort` | all | `default` · `newest` |
| `status` | owner/admin views only | never on public reads |

**Sorting:** without `q`, `sort=default` is a **deterministic** order (type order, then creation time, then id) that reproduces today's "natural order"; `newest` orders by `publishedAt` for news first (extendable to listings by `createdAt` later). **With `q` (Phase 10D, a deliberate change from the 10A draft, which kept the frontend's "no relevance"):** results are ranked deterministically by the title — exact → starts-with → word-prefix → contains → matched only elsewhere — then shorter title, kind order, lower-cased title, id; *suggestions* are ranked likewise (exact → starts-with → word-prefix → contains → shorter → alphabetical). See `READ_API_PARITY.md` §3.

PostgreSQL is sufficient initially (`pg_trgm` + B-tree/GIN; see `DATA_MODEL.md` §9). No Elasticsearch/OpenSearch.

## 5. Resource groups (all under `/api/v1`)

Legend — **Auth:** A anonymous · R signed-in · O owner · P professional · M admin.

| Group | Representative operations | Auth | Why this shape | Owner phase |
|---|---|---|---|---|
| `/health` | `GET /health` (liveness — **implemented in 10B**, no dependency checks), `GET /health/ready` (**implemented in 10C**: `SELECT 1`; `200 {"data":{"status":"ready","checks":{"database":"ok"}}}`, otherwise a `503 service_unavailable` envelope that never names the host, URL or credentials) | A | Operability, container probes | 10B / 10C |
| `/categories` | `GET /categories?module=` (**implemented in 10D**; active categories only — there is no `active` parameter) | A | Feeds forms, filters, discovery pages (replaces hard-coded config) | 10D |
| `/search` | `GET /search` (mixed kinds, `meta.total`), `GET /search/suggestions?q=&type=&limit=` (**implemented in 10D**) | A | **The seam `services/search.ts` was built for**; returns `SearchHit` = `{kind, item}` and the existing flat `SearchSuggestion` shape | 10D |
| `/listings` | `GET /listings/{id}`, `POST /listings`, `PATCH /listings/{id}`, `POST /listings/{id}/archive` | A (detail, approved only) / P,O (writes) | One canonical detail route for all kinds (mirrors the frontend's single detail per kind) | 10D (read — **implemented**), 12 (write) |
| `/news` | `GET /news`, `GET /news/{id}` (**implemented in 10D**; published only); admin writes under `/admin/news` | A / M | News is not a listing; no moderation | 10D (read) / 12 (write) |
| `/users` | `GET /users/me/listings?status=`, `PATCH /users/me` (profile) | R | Owner's own view of all statuses (the Professional "My Listings"); **identity, roles and plan come from `GET /auth/me`** | 12 |
| `/saved` | `GET /saved`, `PUT /saved/{listingId}`, `DELETE /saved/{listingId}` | R | `PUT`/`DELETE` are idempotent (duplicate Saved is impossible and harmless) | 12 |
| `/requests` | `POST /requests`, `GET /requests`, incoming leads for owners, status transitions | R / P | Request Service + Leads; transitions follow `REQUEST_TRANSITIONS`; **detail deferred** | 12 |
| `/auth` | `register`, `login`, `logout`, `logout-all`, `me`, `verify-email`, `resend-verification`, `forgot-password`, `reset-password`, `change-password` (**11B**); `oauth/google/start`, `oauth/google/callback`, `DELETE oauth/google` (**11C**). **No `refresh`** — sessions are server-side. | A / R | Frozen in `AUTH_RBAC.md` §12 | 11B / 11C |
| `/admin` | `GET /admin/listings?status=` (+ counts in `meta`), `POST /admin/listings/{id}/approve`, `…/reject`, `/admin/categories` CRUD, `/admin/news` | M | Admin surface is separate so authorization is by prefix + dependency, never per-field | 12 |

### Why these (and not others)

- **No per-kind public collections** (`/businesses`, `/properties`, `/services`, `/education`): the frontend already reads every kind through one `searchAll(q, type, filters, sort)`; a second set of collection endpoints would duplicate it. Public browsing = `/search`; kind pages use `type`/filters. *(This deliberately differs from the illustrative `GET /listings` collection in the Phase 10A brief; a public `GET /listings` collection can be added later if a non-search consumer appears.)*
- **No `/food` endpoint family:** Food is `type=business&vertical=food&foodCategory=…&service=…`.
- **Three read surfaces with different authorization instead of one endpoint with privileged filters:** public (`/search`, `/listings/{id}` → approved only), owner (`/users/me/listings` → all own statuses), admin (`/admin/listings` → all, with `status` filter and per-status counts for the queue). `status` is never a public filter.
- **State changes are actions, not field writes:** moderation and archiving are `POST …/{action}` because they are state-machine transitions with side effects (history row, validation, quota), not "set `status`". Clients cannot `PATCH` `status`, `ownerId`, `featured`, `revision` — those fields are rejected.
- **Edit = `PATCH`, with an explicit side effect:** a content edit by the owner moves a non-archived listing to `pending` (frontend behavior) and increments the integer `revision` counter. The response returns the new `status`/`revision` so the UI can say "resubmitted for review". Partial-update semantics (omitted = unchanged, `null` = clear where allowed) are those in *Null vs omitted* above. Clients never call a separate "resubmit".
- **Create = create-and-submit:** `POST /listings` creates the listing in `pending` (today's lifecycle has no `draft`). A `POST /listings/{id}/submit` action is **reserved** for a future `draft` state; it is not part of V1.

### Moderation and concurrency

```
POST /api/v1/admin/listings/{id}/approve   { "revision": 3 }
POST /api/v1/admin/listings/{id}/reject    { "revision": 3, "reason": "Please add opening hours." }
```

`revision` is the integer concurrency/version counter of the listing's content (current architecture, not deferred) — here, the value the admin reviewed; a mismatch (owner edited meanwhile) or a non-`pending` status → `409 invalid_state_transition`. `reason` is required (≥10 characters) for reject. The updated listing is returned. Create endpoints may accept an optional `Idempotency-Key` header (reserved).

### Writes: payload sketch (Food business)

```json
POST /api/v1/listings
{
  "kind": "business",
  "name": "Sweet Crumbs Bakery",
  "vertical": "food",
  "description": "Fresh cakes and bread baked every morning.",
  "area": "B-17, Block B",
  "tags": ["cakes", "bread"],
  "food": {
    "categories": ["bakeries", "cafes"],
    "serviceOptions": ["takeaway", "delivery"],
    "hoursNote": "Daily, 8 AM–10 PM",
    "menuHighlights": [{ "name": "Fudge Cake", "price": "PKR 1,800" }]
  }
}
```

General business / provider / property / tutor use `category` (a **slug**) instead of `food`; a Food business never sends `category` (it is derived from the primary Food category, exactly as the frontend builder does). Client-supplied `status`, `submittedBy`, `featured`, `id` and `blob:` image URLs are rejected (`validation_error`). The request schemas are discriminated on `kind` and carry the same limits the frontend enforces (name ≤80, description 20–400, ≤3 Food categories, ≤8 menu items, …) — the server re-validates everything; the client's checks are UX.

## 6. Search contract (the seam for `services/search.ts`)

`GET /search?q=&type=&area=&category=&…&sort=&limit=&offset=` → `data: SearchHit[]` where `SearchHit = { kind, item }` and `item` is the per-kind DTO of §2; `meta: { total, limit, offset }`. Only publicly visible content is returned (approved listings, published news). `GET /search/suggestions?q=&type=&limit=` → `data: SearchSuggestion[]` with the existing flat shape (`id`, `label`, `secondaryLabel`, `type`, `value`); minimum query length 2; suggestions are built only from fields the search matches on, so selecting one always yields results (the V2.1 rule). Filter option lists (areas, categories) come from `/categories` and a lightweight facets read when needed, not from client-side scanning of all data.

### 6.1 As implemented in Phase 10D

* **`GET /search`** — parameters (all optional): `q` (≤ 100 chars, trimmed, case-insensitive substring), `type` (`all|provider|business|tutor|property|news`), `area`, `category`, `subject`, `grade`, `bedrooms` (minimum, 1–20), `furnished` (`Furnished|Unfurnished|Semi-Furnished`), `listingType` (`sale|rent`), `propertyType`, `vertical`, `foodCategory`, `service`, `sort` (`default|newest`), `limit` (1–50, default 12), `offset` (0–100000). Filters are **kind-aware** (a filter only narrows kinds that have the field). Finite-choice filters are **validated**: absent (or blank) = no filter, a known value = apply it, an unknown value = `422 validation_error` (`details[].field` names the parameter) — never a silently broader query. This covers `type`, `sort`, `furnished`, `listingType`, `vertical` and `service`; free-text and open-data parameters (`q`, `area`, `grade`, and the slug filters `category`, `subject`, `propertyType`, `foodCategory`) are never rejected for being unknown — they simply match nothing. Response `data` is `SearchHit[]` (`{kind, item}`), `meta` is `{total, limit, offset}`. Search cards omit the Food menu.
* **`GET /search/suggestions`** — `q` (< 2 characters → `[]`), `type`, `limit` (1–20, default 8) → `{id, label, secondaryLabel, type, value}[]`, built only from public searchable content, ranked and de-duplicated, one SQL statement.
* **`GET /listings/{id}`** — the public detail, discriminated on `kind` (`provider|business|tutor|property`); Food businesses include `food` (`categories`, `serviceOptions`, `hoursNote?`, `menuHighlights?`, `menuImage?`) and every listing carries `categories: [{slug, name, isPrimary}]`.
* **`GET /news`**, **`GET /news/{id}`** — `{id, kind: news|update, status: "published", title, category, categorySlug, summary, image?, publishedAt, tags}`; `kind` filter, newest first.
* **`GET /categories?module=`** — `{id, module, slug, name, parentId?, displayOrder}[]`, active only.
* **Visibility:** approved listings and published news only. Hidden, unknown and malformed ids all return the same `404 not_found` envelope. Invalid query values return the `422 validation_error` envelope with `details[].field`.
* All responses use camelCase and omit null fields; `meta` appears only on paginated reads. Verified example (`GET /api/v1/search?q=biryani&limit=1`): `{"data":[{"kind":"business","item":{"id":"…","name":"Karachi Biryani House","vertical":"food","category":"Biryani / Rice","food":{"categories":["biryani-rice","desi-food"],"serviceOptions":["dine-in","delivery"],"hoursNote":"Daily, 12 PM–11 PM"}, …}}],"meta":{"total":1,"limit":1,"offset":0}}`.

## 7. Cross-cutting HTTP behavior

- **CORS:** exact-origin allow-list; see `BACKEND_ARCHITECTURE.md` §7. Never `*` with credentials.
- **Caching:** public reads may send `Cache-Control`/`ETag`; authenticated and owner/admin responses are `no-store`.
- **Rate limiting:** auth, request creation and suggestions get limits (`429` + `Retry-After`) — implemented with Phase 11/12, no Redis assumed.
- **Offline PWA:** the service worker does not cache API responses; the frontend's existing "offline mutation blocked" rule is unchanged.
- **Versioned OpenAPI** is published from the app (`/api/v1/openapi.json`, with `/docs` and `/redoc`) **outside production only** (`ENVIRONMENT=production` disables all three) and is the basis for contract tests and, optionally, a generated TypeScript client.

## 8. Mapping the frontend seams (for Phase 12)

| Frontend seam today | Becomes |
|---|---|
| `searchAll`, `getSearchSuggestions`, `get…ById`, `getNews…` in `services/search.ts` | `/search`, `/search/suggestions`, `GET /listings/{id}`, `GET /news…` behind the same function signatures |
| `useListingsStore` (`submitListing`, `resubmitListing`, `archiveListing`, `setStatus`) | `POST/PATCH /listings`, `POST …/archive`, `/admin/listings/{id}/approve|reject` |
| `useResidentStore.savedItems` | `/saved` (server-authoritative; localStorage becomes a cache) |
| `useResidentStore.requests`, `updateRequestStatus` | `/requests` |
| `usePlanStore`, `PLAN_ENTITLEMENTS` | `GET /auth/me` returns `professional.planCode` (and roles); the frontend maps it to capabilities with its existing config; capability checks stay UX-only |
| `AuthProvider` demo login, admin demo login | `/auth/*` — one identity system; `/admin/login` is only a different screen posting to the same `/auth/login` (`AUTH_RBAC.md` §15) |
| `useNewsStore` | `/news`, `/admin/news` |

## 9. What is intentionally not frozen here

Exact request/response schemas of `/requests`, `/auth`, `/admin/categories`, `/admin/news`, notification endpoints, media upload/signing endpoints (`MEDIA_STORAGE.md`), user profile fields, the cookie-vs-bearer decision, and rate-limit numbers. Each is owned by the phase in §5; they must follow §1–§4 (envelopes, camelCase, null/omitted, error codes, pagination, no `status` writes).
