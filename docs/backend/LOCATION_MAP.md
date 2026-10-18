# B-17 Portal — Location & Maps

**Status:** **frozen by Phase 12A; the backend foundation is IMPLEMENTED in Phase 12B** (migration `0005`, model, public serialization, search document, fixtures — §19) **and the write validation in Phase 12D** (§20). Map display and the picker land in 12G/12H; see `ROADMAP.md`.
**Owns:** the shared location data model, field semantics, requiredness per listing kind, the privacy model (exact / approximate / area-only) and how it is enforced server-side, public vs owner/admin serialization, search-document rules, the map stack and tile policy, directions, geocoding policy, the map picker, the future map-search / near-me path, indexing, fixtures and the location test plan.
**Does not own:** the write endpoints, lifecycle and ownership rules → [`API_CONTRACT.md`](API_CONTRACT.md) §10 · guards, sessions, CSRF and frontend auth → [`AUTH_RBAC.md`](AUTH_RBAC.md) §22 · generic table conventions → [`DATA_MODEL.md`](DATA_MODEL.md) · hosting and tile operations → [`DEPLOYMENT.md`](DEPLOYMENT.md) §11 · visual conventions → [`../design/DESIGN_SYSTEM.md`](../design/DESIGN_SYSTEM.md) §11.1.

> **B-17 Portal is hyperlocal, so location is a first-class, shared concern — not a per-kind afterthought.** Every listing kind (provider, business incl. Food, property, tutor) uses the *same* location fields, the *same* privacy rules and the *same* map components.

## 1. Decisions at a glance

| # | Decision |
|---|---|
| L1 | **Location lives on `listings`** (shared base row), not duplicated per subtype and not in a side table: `block`, `address`, `landmark`, `latitude`, `longitude`, `location_visibility`, plus two **database-generated** public-coordinate columns. `area` is unchanged. |
| L2 | **Coordinates are `numeric(9,6)` decimal degrees** (≈ 0.1 m), validated `-90..90` / `-180..180`, never strings, never floats at rest. No PostGIS now. |
| L3 | **Privacy is a server-side property, not a UI choice.** `location_visibility` ∈ `exact` · `approximate` · `area_only`. The exact point and the address are *private-capable* columns that no public code path loads. |
| L4 | **Approximation is frozen at 2 decimal places, deterministic, derived in the database, and auditable:** `public_latitude/longitude = round(exact, 2)` (a ≈ 1.1 km grid) for `approximate`, the exact value for `exact`, `NULL` for `area_only`. No random jitter, no other precision. |
| L5 | **`area_only` stores no coordinates at all** (database `CHECK`). Narrowing a listing to `area_only` *erases* the pin. |
| L6 | **Requiredness depends on the kind** (§6): a property always has a point; a physical business has one unless it declares `area_only`; a service provider or tutor defaults to `area_only`. |
| L7 | **Map stack: Leaflet 1.9.x used directly through our own thin wrapper**, OpenStreetMap-compatible raster tiles supplied by configuration. **Not `react-leaflet`** (its licence is not OSI-approved — §10.1). No Google Maps JavaScript API. |
| L8 | **Get Directions = a plain external Google Maps URL** built from *public exact* coordinates. No API key. Not offered for approximate / area-only listings. |
| L9 | **Manual address + manual pin.** No geocoding, no reverse geocoding, no browser geolocation in V1; a provider seam is documented for later. |
| L10 | **Future map search and near-me work from the same columns** (`public_latitude/longitude` only — never the exact point) and need no schema redesign. PostGIS is adopted only on evidence (§14). |
| L11 | **Exact address and landmark enter `search_document` only for `exact` listings**; the exact point never does. Suggestions never draw on location text. |
| L12 | **CI never contacts a tile server.** The map engine sits behind an interface that tests replace; E2E stubs tile hosts. |
| L13 | **`0005` is purely additive and guesses nothing.** Existing rows become a documented, valid *legacy state* (area-only, no point, `area` untouched); nothing is parsed, normalised or invented. New writes and all owner edits enforce the new rules (§3.1). |
| L14 | **New-write semantics: `area` = a canonical locality (`B-17`), `block` = a separate field.** The database validates coordinate ranges only; **no B-17 geofence** exists until authoritative geographic data is available (§5). |
| L15 | **Only a *pure* visibility narrowing keeps an approved listing approved** (§7.4); any other change — or any widening — returns it to `pending`. |

## 2. Why shared columns on `listings`

| Option | Verdict |
|---|---|
| **Columns on `listings`** (chosen) | One privacy rule, one serializer, one set of tests for every kind. Search cards and future map pins read location from the row they already read — **no join, no N+1**. Public coordinates are available to a future bbox/radius query on the same table that carries `status`. |
| Columns on each subtype | Provider has no subtype table; the rest would duplicate columns, constraints, serializer branches and tests four times. **Rejected.** |
| A 1:1 `listing_locations` table | A stronger *structural* wall around private data, at the cost of a join on every card and a second place for status-dependent queries. The same wall is achieved without the join by the ORM guard below (private columns are `deferred` at mapper level and explicitly `raiseload`-ed in every public read). Revisit if location ever gains many-to-one needs (several locations per listing, service-area polygons). |
| PostGIS `geography` column | Needs the extension, an image change and spatial tooling for a few thousand points. **Deferred with explicit triggers (§14).** |
| JSONB blob | No constraints, no types, no index path. **Rejected** (same reasoning as `DATA_MODEL.md` §4). |

**Structural privacy guard (binding on 12B).** The ORM maps `latitude`, `longitude`, `address` and `landmark` with `deferred=True`; `ListingReadRepository` (public detail and card hydration) additionally applies `defer(..., raiseload=True)` to them and loads only `block`, `location_visibility`, `public_latitude`, `public_longitude`. A public code path that *touches* a private attribute therefore raises in tests instead of silently leaking, and the generated SQL of every public query is asserted not to select those columns. Owner and admin repositories `undefer` them explicitly.

## 3. Schema (migration `0005`, implemented in slice 12B)

Added to `listings` (nothing else about `0001`–`0004` changes):

| Column | Type | Null | Public? | Notes |
|---|---|---|---|---|
| `block` | `varchar(40)` | yes | **always** | Free text, trimmed (§5). No taxonomy is invented. `area` (existing) stays as it is. |
| `address` | `varchar(200)` | yes | only if `exact` | The human-readable counterpart of the pin; entered by the user. |
| `landmark` | `varchar(100)` | yes | only if `exact` | "Opposite …". Treated like the address: it can identify a place. |
| `latitude` | `numeric(9,6)` | yes | **never** (see `public_*`) | The exact stored point. |
| `longitude` | `numeric(9,6)` | yes | **never** | |
| `location_visibility` | `varchar(16)` + `CHECK` | no, default `'area_only'` | — | `exact` · `approximate` · `area_only`. The default is the safe value for legacy and curated rows. |
| `public_latitude` | `numeric(9,6)` | generated, stored | **the only coordinate the public API may read** | `CASE location_visibility WHEN 'exact' THEN latitude WHEN 'approximate' THEN round(latitude, 2) END` |
| `public_longitude` | `numeric(9,6)` | generated, stored | same | same expression on `longitude` |

Constraints (named per the project convention): `ck_listings_location_visibility_valid`; `ck_listings_coordinates_pair` (`(latitude IS NULL) = (longitude IS NULL)`); `ck_listings_latitude_range`, `ck_listings_longitude_range`; **`ck_listings_visibility_matches_point`** — `(location_visibility = 'area_only') = (latitude IS NULL)` (area-only ⇔ no stored point; exact/approximate ⇔ a point); `ck_listings_block_not_blank`, `address_not_blank`, `landmark_not_blank` (`NULL` or non-blank). Row-local rules only — *requiredness per kind* and *address required when exact* are service rules (§6) because the database cannot know the kind's policy without a trigger.

Why generated columns: the public coordinate cannot drift from the exact one (the database computes it), a public query can be written so it **never mentions** the private columns, the future bbox/near-me index is built on public values only, and a later PostGIS `geography` column can be generated from the same inputs. The rounding precision (2 decimals) is frozen (§7.2); changing it would be a deliberate new migration (drop and re-add the two generated columns).

### 3.1 Legacy rows and the `0005` upgrade (frozen)

**Starting point.** At `0004` every listing has the old free-text `area` and *nothing else*: no block, no address, no coordinates. A Property row without a point (which new writes could not create) is therefore normal in an existing database — dev / test / staging fixtures today; there are no real production listings yet, but the strategy does not depend on that.

**What `0005` does.** DDL only — **no `UPDATE`, no `INSERT`, no data statement of any kind**:

1. Adds `block`, `address`, `landmark`, `latitude`, `longitude` (all nullable — metadata-only) and `location_visibility NOT NULL DEFAULT 'area_only'` (a constant default: no per-row work).
2. Adds the two stored generated columns (`public_latitude`, `public_longitude`). PostgreSQL computes them once for every existing row — a single rewrite of `listings` under an `ACCESS EXCLUSIVE` lock, which is acceptable at B-17's table size and runs in the normal migration window. For every existing row the result is `NULL` (area-only).
3. Adds the `ck_listings_*` constraints. Every existing row already satisfies them (area-only, no point), so validation cannot fail and **no row has to be "fixed"**.
4. The downgrade drops constraints, then the generated columns, then the columns; the only information lost is location data created after the upgrade.

**The resulting legacy state — a valid, documented, transitional state:** `location_visibility = 'area_only'`, `block` / `address` / `landmark` / `latitude` / `longitude` `NULL`, `area` **byte-for-byte unchanged**, `search_document` unchanged (identical composition for rows without a block), `updated_at` untouched. **Nothing is inferred:** no coordinate is guessed, no `Block C` is parsed out of an `area` string into `block`, no address is extracted, no `area` is normalised.

**Public behaviour of a legacy row** (all kinds, including a legacy Property): `area` is returned exactly as before; `location` is `{ "visibility": "area_only" }` with no block and no coordinates; no map is rendered, no Get Directions is offered; search, the `area` filter and text matching behave as before. A legacy row can never produce an exact location.

**Rules from Phase 12 on:**

- **New listings and every owner edit** validate the *resulting* state against §6. Editing a legacy Property — even to fix a typo — therefore needs a valid location (`422` `details[].code = required` until it has one). Legacy business / provider / tutor rows are already valid as `area_only` and may be edited without adding a location.
- **`area`** is validated against the canonical localities (§4) **whenever it is supplied**; an edit that omits it leaves the legacy text alone, but the edit form always sends the whole form, so in practice the owner picks the canonical locality at the first edit.
- **Archiving, and admin approve / reject, never validate location** — a legacy listing can always be moderated or retired.
- **Fixtures** are changed explicitly (§15), never by the migration.

**Cleanup — when it becomes safe.** The legacy state is a valid state, so nothing needs removing from the schema. Track it with a read-only drift query: Property rows with `location_visibility = 'area_only'`, and rows whose `area` is not a canonical locality. Only when that query returns **zero in every environment** (fixtures reseeded; owners have completed their edits or archived), a later migration may add the validated database rule `ck_listings_property_has_point` (`kind <> 'property' OR latitude IS NOT NULL`). It must **not** be added as `NOT VALID` earlier: PostgreSQL re-checks a `NOT VALID` constraint on every `UPDATE` of a violating row, which would block approving, rejecting or archiving legacy rows. Area values cannot be a database rule (they are configuration).

**How an existing dev database upgrades.** `alembic upgrade head` (from `0004`) → `python -m scripts.dev_fixtures` (idempotent; applies the explicit demo-location step of §15 to the fixture ids only; refuses production) → `python -m app.db.search_index check`. No other step, no data loss, no manual SQL.

**Migration tests (slice 12B).** At revision `0004`, insert listings of every kind and status with arbitrary legacy `area` strings; upgrade to `0005`; assert for every row: `area`, `status`, `revision`, `search_document` and `updated_at` unchanged; `location_visibility = 'area_only'`; every other location column and both public columns `NULL`; all `ck_listings_*` constraints present and validated; the public detail and search cards for those rows return `area_only` with no coordinates and no error; a legacy Property is readable; downgrade to `0004` keeps every row and re-upgrade succeeds; `alembic check` reports no drift; `search_index check` is clean.

## 4. Field semantics

| Field | Meaning | Rules |
|---|---|---|
| `area` *(existing column)* | **For new writes: the canonical locality** — `B-17` — and nothing else; the block is a separate field. The public filter and cards still use it as before. | Required, and — when supplied by a create or edit — one of the configured localities (`LOCALITIES`, default `B-17`; matched trimmed and case-insensitively, stored in the configured spelling; anything else → `422 unknown_locality`). The exact-match filter is unchanged. Always public. **Legacy rows keep whatever free text they have** (e.g. `B-17, Block C (Demo Area)`); it is never rewritten or parsed (§3.1). |
| `block` | The block / sector label within the area, as the owner types it (`C`, `Block C`). | Optional, 1–40 characters, trimmed, letters/digits/space/`-`/`/`/`.`, no control characters. Always public. |
| `address` | Street / plot / shop text. | Optional, 1–200 characters, printable. Public **only** when `exact`. Required when `exact` for business and property. |
| `landmark` | Optional wayfinding hint. | Optional, 1–100 characters. Public only when `exact`. |
| `latitude` / `longitude` | The pin. | JSON **numbers** (strings rejected), finite, `latitude` in `-90..90`, `longitude` in `-180..180`, at most 6 decimals after rounding (the server rounds half-even to 6 and stores `numeric(9,6)`). Both or neither. **Nothing else is validated** — no B-17 geofence, no "null island" rule (§5). |
| `location_visibility` | How much of the above the public may see (§7). | Required on write unless a kind default applies (§6). |

## 5. B-17 scope

- The product is B-17, Islamabad, but **current data does not support a block taxonomy**: demo `area` strings use `Block A`–`Block E` and are explicitly labelled `(Demo Area)`, so those letters are not authoritative. **No block list, no street data and no area polygon is invented.** `block` is validated free text now; a managed lookup (`areas` / `blocks`) remains the future seam under O-1 and would add an FK without changing the API shape.
- **New-write semantics (frozen):** `area` is the canonical locality — `B-17` — chosen from the configured `LOCALITIES` list (a setting, default `B-17`, mirrored by the frontend config; a managed `areas` lookup is the future home under O-1 and would not change the API shape). `block` is the separate, optional, free-text block label. The two are never concatenated into one string.
- **Legacy `area` text is not touched.** Existing rows keep strings such as `B-17, Block C (Demo Area)`; they are not parsed into `block`, not normalised, not rewritten by a migration. Until legacy data is gone, the `area` filter's option list may show both legacy strings and `B-17` (accepted transitional fragmentation, §3.1).
- **No geofencing in V1 (frozen).** `0005` and the write API validate only `latitude ∈ [-90, 90]` and `longitude ∈ [-180, 180]` (plus the pair rule). A B-17 bounding box, polygon, swapped-axis detection and null-island checks are **deferred until authoritative geographic data is available** — no coordinates are invented for them, there is no `LOCATION_COVERAGE_BBOX` setting and no frontend bounds variable. The consequence (an out-of-area pin is accepted) is mitigated by the picker's default centre and by the moderator seeing the exact pin and map on the admin review (12H). Recorded as a future validation enhancement (§18).

## 6. Requiredness by listing kind (service rules, validated on the *resulting* state of create and edit)

| Kind | Allowed visibility | Default if `location` omitted | Point | Address |
|---|---|---|---|---|
| **Business — General** | exact · approximate · area_only | *not defaulted* — `location` is required (a conscious choice) | required unless `area_only` | required when `exact` |
| **Business — Food** | exact · approximate · area_only | *not defaulted* — required | required unless `area_only` | required when `exact` |
| **Property** | exact · approximate | *not defaulted* — required | **always required** | required when `exact` |
| **Provider** (services) | exact · approximate · area_only | `area_only` (coverage area = `area` + `block`) | optional (required for exact/approximate) | optional (required when `exact`) |
| **Tutor / education** | exact · approximate · area_only | `area_only` | optional (required for exact/approximate) | optional (required when `exact`) |

Notes: a mobile / home-based / online business or professional uses `area_only` and exposes only its area. A *home-based* tutor or provider should choose `approximate` or `area_only`; the picker explains this in plain language and defaults to `area_only`. A property for rent that is occupied may choose `approximate`. `exact` is never forced on anyone whose kind permits `area_only`. Tutor creation has no UI today (seed-only), so the rule is defined now and exercised when the tutor onboarding flow is built.

**Legacy exception (§3.1):** these requirements apply to *new* listings and to the *resulting state of every owner edit*. A pre-`0005` Property (area-only, no point) is tolerated as stored and rendered area-level, but cannot be edited or resubmitted without gaining a valid location.

## 7. Privacy model

### 7.1 Visibility modes

| Mode | Stored | Public API returns | Owner / admin API returns |
|---|---|---|---|
| **`exact`** | point, address, landmark, block | `block`, `address`, `landmark`, **exact** coordinates (`precision: "exact"`) | everything |
| **`approximate`** | point, (address, landmark, block — private except `block`) | `block` and the **rounded** coordinates (`precision: "approximate"`); **no address, no landmark, no exact point** | everything, plus the rounded point the public sees |
| **`area_only`** | **no point**; address / landmark optionally (admin verification) | `area` and `block` only; **no coordinates** | block, and address / landmark if given; no point |

### 7.2 The approximation (frozen — 2 decimal places)

- **Exact rule for migration `0005`:**
  `public_latitude  = CASE location_visibility WHEN 'exact' THEN latitude  WHEN 'approximate' THEN round(latitude, 2)  END`
  `public_longitude = CASE location_visibility WHEN 'exact' THEN longitude WHEN 'approximate' THEN round(longitude, 2) END`
  (`round(numeric, 2)` rounds half away from zero; `area_only` yields `NULL`). I.e. the nearest point of a **0.01° grid** — about 1.11 km north–south and 0.93 km east–west at B-17's latitude. Every `approximate` listing in the same grid cell shares one public point. This is the only approximation in the system.
- **Why 2 decimals, and not 3:** `approximate` is a *privacy feature*. Three decimals (≈ 100 m) would still locate a house within a lane and is too precise for a home-based tutor or professional. Anyone who needs precise discovery chooses `exact`; anyone who wants no point at all chooses `area_only`. The precision is **not** a product-owner open choice any more.
- **Why this and not jitter:** it is a pure function of the stored point — the same input always gives the same output, nothing is random per request (jitter that is regenerated per request can be averaged away or triangulated by repeated queries), and it is auditable in one SQL expression. Moving the pin *within* a cell does not change the public output.
- **Public behaviour must use the public columns only.** Every public read, search, filter, sort, map pin and (future) bbox / radius / near-me query uses `public_latitude` / `public_longitude` and **never** `latitude` / `longitude`, for any mode. An `approximate` listing is therefore never ranked or filtered by its exact position.
- **Rendering and copy:** the map labels it **"Approximate location"** and draws an *illustrative* translucent circle around the public point instead of a pin; no pin, no directions. The circle is a visual cue only — **the product never states or implies a guaranteed privacy radius or accuracy** (the real uncertainty depends on where the owner's point sits inside its grid cell). Engineering note, not user copy: the nearest-grid-point error is bounded by roughly 0.7 km at this latitude.
- No B-17 centroid, block centre or other "snapped" location is calculated — there is no authoritative data for one.

### 7.3 Internal vs public serialization (enforced by schema and service)

- The **public** schemas (`/search`, `/listings/{id}`) are explicit Pydantic models with **no field** for the exact point, `address`/`landmark` under non-exact visibility, or any private column. The mapper reads `block`, `location_visibility`, `public_latitude`, `public_longitude` and — only when the mode is `exact` — `address` and `landmark`.
- The **owner** (`GET /users/me/listings…`) and **admin** (`GET /admin/listings…`) schemas are separate models containing the full location, `status`, `revision`, rejection reason, **and `publicLocation`** — exactly what an anonymous visitor would receive — so the owner sees the consequence of their privacy choice. Both are `Cache-Control: no-store`; ownership failures answer `404` (never `403`).
- **Hiding in the frontend is never the protection.** The exact point of an `approximate` or `area_only` listing is never sent to a browser that is not its owner or an admin.
- Distance-style queries (future) must use `public_*` only. Ranking by distance from the *exact* point would let a caller triangulate it from many query positions.

### 7.4 Changing visibility after approval (frozen — closes the narrowing loophole)

A privacy-protective change must take effect immediately, but it must never become a way to smuggle an unreviewed content change past moderation. Let **S** be the stored state and **R** the state the request would produce, both after normalisation (trim, case, rounding, tag normalisation).

**A request is a *pure visibility narrowing* if and only if ALL of these hold:**

1. The visibility change is exactly one of: `exact → approximate`, `exact → area_only`, `approximate → area_only`.
2. **Every other moderated value is equal in R and S:** title / name, description, tags, image, `area`, `block`, `address`, `landmark`, categories, every subtype field (grade, listing type, property type, price, bedrooms, furnishing, vertical), the whole Food profile (categories, service options, hours, menu items, menu image) and any contact field that may exist in future.
3. The only permitted consequence of the new mode is **technical clearing**: for `→ area_only` the stored `latitude` / `longitude` become `NULL` (required by the database rule L5); for `→ approximate` the stored point is **identical** (only the database-generated public point changes). *Nothing else may be cleared or edited* — not the address, not the landmark, not the block.

**Effect of a pure narrowing:** applied immediately; `revision` + 1; `updated_at` updated; `search_document` refreshed in the same transaction (the address / landmark drop out of it). **Status does not change** in any non-archived state (`approved` stays `approved`; `pending` stays `pending` without being resubmitted or losing its queue position; `rejected` stays `rejected` — a narrowing never resubmits). `submitted_at` is unchanged. **No `listing_status_history` row is written** (history records lifecycle transitions only; the revision bump and `updated_at` are the record, and a future `listing_revisions` table would capture the detail). An `archived` listing is not editable (`409 invalid_state_transition`).

**Everything else is an ordinary edit.** On an `approved` listing it moves it to `pending`: `revision` + 1, `submitted_at` reset, `search_document` refreshed, and **one `listing_status_history` row** — action `resubmitted`, `from_status = approved`, `to_status = pending`, the new `revision`, actor = the owner. That includes:

- **Any widening** — `area_only → approximate`, `area_only → exact`, `approximate → exact` — even if nothing else changes.
- **A narrowing combined with any other effective change**, however small: moving the pin by any distance, changing `area`, `block`, `address` or `landmark` (including clearing them), `title`, `description`, tags, image, categories, a price or other subtype field, a menu item, a Food setting, a contact field.
- **Same-visibility edits** of any location value (a moved pin, a new address) — these are content changes.

A request that changes nothing after normalisation is a no-op (`200`, nothing written) — see `API_CONTRACT.md` §10.3. A stale `revision` is `409 listing_conflict` for narrowing too; and because a narrowing bumps `revision`, an admin `approve` / `reject` issued against the old revision gets the same `409` and reloads (acceptable: the admin then sees the current state).

Every change to `location_visibility`, `address`, `landmark` or `block` refreshes `search_document` in the same transaction.

### 7.5 Not claimed

Rounding does not make an approximate pin safe against someone who already knows who the owner is and where they live; it prevents the platform from *publishing* the exact home point. `area_only` is the strongest option. The API never claims more than that in its copy.

## 8. API shapes (the contract detail lives in `API_CONTRACT.md` §10; shown here for the location part)

**Write** (`POST /listings`, `PATCH /listings/{id}`): `area` stays a top-level field; everything else is one `location` object that **replaces the whole location block** on `PATCH` (omitted sub-fields are cleared — merging would let an invariant like "area_only ⇒ no point" be violated by omission):

```json
"area": "B-17",
"location": {
  "visibility": "exact",
  "block": "B",
  "address": "Shop 4, Main Market",
  "landmark": "Opposite the mosque",
  "latitude": 33.123456,
  "longitude": 72.123456
}
```

**Public read** (detail and search cards share the shape; cards omit `address` / `landmark` to stay small — they are detail-page content):

```json
"area": "B-17",
"location": {
  "visibility": "approximate",
  "block": "B",
  "coordinates": { "latitude": 33.12, "longitude": 72.12, "precision": "approximate" }
}
```

`coordinates` is **omitted** for `area_only` (and for every legacy row, §3.1). The field set is additive to the existing read schemas (`API_CONTRACT.md` §1: new optional fields stay in v1). Search hydration already loads the listing row, so no extra query or round trip is added (the N+1 assertions in the search tests keep their statement counts).

**Owner / admin read:** `location: { visibility, block?, address?, landmark?, latitude?, longitude? }` and `publicLocation` (the public shape above).

## 9. Search

- `search_document` gains: `block` (always; stored as typed, plus `block <value>` when the value does not already start with "block", so "block c" finds block `C`) and — **only for `exact` listings** — `address` and `landmark`. The exact point never enters it and neither do `approximate` / `area_only` addresses. Legacy rows are unchanged (no block).
- Because the document depends on visibility, **any change to visibility, address, landmark or block calls `SearchIndexer` in the same transaction** (the existing contract); `find_stale()` / `python -m app.db.search_index check` detect a document built under a different visibility, which the tests exercise by flipping visibility.
- `GET /search/suggestions` is unchanged: suggestions come from titles, categories, tags, menu items and grades — **never** from `area`, `block`, `address` or `landmark`.
- Filters: `area` stays exact-match. A `block` filter is *not* part of V1 (a block is findable through text search); if it ships, it adds a partial composite index (§13).

## 10. Map stack

### 10.1 Library

**Leaflet `1.9.x`** (BSD-2-Clause), used **directly** inside our own components, loaded lazily (`React.lazy`) so the ~150 kB map code is in its own chunk and never on the initial path (Phase 9H splitting is preserved). The React bindings package **`react-leaflet` 5.0.0 is not used**: although its peer range fits React 19, its licence is *Hippocratic-2.1* — an ethical-source licence that is not OSI-approved and would need legal review. A direct wrapper is small (a `useEffect` that creates and disposes the map) and removes a dependency. If the licence is reviewed and accepted later, the wrapper can be swapped without touching callers because everything goes through the `MapEngine` interface (§11).

Rejected for V1: Google Maps JavaScript API (billing, key management, vendor lock-in for plain markers), MapLibre GL (vector tiles need a tile server and WebGL, and weigh more than a few markers justify).

Leaflet's default marker icon relies on image URLs that bundlers break; we use a CSS `divIcon` styled with the design tokens, so no extra image assets are shipped.

### 10.2 Tiles — development vs production

- **Configuration, not code:** `VITE_MAP_TILE_URL` (a `{z}/{x}/{y}` template), `VITE_MAP_TILE_ATTRIBUTION`, and `VITE_MAP_DEFAULT_CENTER` (`lat,lng`; the picker's start position — no view limits or geofence in V1, §5). Attribution is always rendered and never hidden.
- **Development / demo:** the standard OpenStreetMap raster tiles, used lightly and subject to the OSM Tile Usage Policy (attribution, a valid `Referer`/identification, no bulk downloading or pre-fetching, no offline caching). The public OSM tile servers are a community resource, **not** a production CDN, and may refuse heavy or anonymous traffic.
- **Production:** a compliant provider chosen at deployment time (a commercial raster/vector tile service with a free tier, or self-hosted tiles). No paid provider is added now, and none is named or priced here. Switching providers is a configuration change.
- **Service worker:** it ignores cross-origin requests (`pwa/sw.template.js`), so tiles are never cached by the app — which is what the OSM policy requires. This must not change.
- **Referrer interplay:** the verification / reset pages keep `Referrer-Policy: no-referrer` (`AUTH_RBAC.md` §8). OSM-hosted tiles require a referrer, so the policy is set **per route** (no-referrer for those two pages; a standard `strict-origin-when-cross-origin` elsewhere) and/or per tile request through Leaflet's tile-layer referrer option — to be verified in 12G. Map pages carry no secrets, and URL fragments are never sent in a `Referer` anyway.
- **CSP:** none exists today. If one is added, `img-src` must allow the configured tile host and nothing broader.

## 11. Frontend architecture (conceptual — not built in 12A)

Shared, kind-agnostic components in `src/components/location/`, types in `src/types/location.ts`, config in `src/config/map.ts`:

| Component | Role |
|---|---|
| **`MapEngine`** (interface) + `LeafletEngine` | The only code that imports Leaflet. `mount(element, options)`, `setMarker`, `setCircle`, `onPick`, `destroy`. Lazy. Tests substitute a fake engine, so no test needs Leaflet, a canvas or the network. |
| **`MapView`** | Read-only map for a *public* location: exact → marker; approximate → an illustrative circle labelled "Approximate location" (no radius or accuracy is claimed); area-only → renders nothing (the parent shows area text). Props are the public location shape, so it cannot be given private data. |
| **`MapMarker`** | The token-styled marker element used by `MapView` and `LocationPicker`. |
| **`LocationPicker`** | The form control: map + draggable marker, visibility selector, block / address / landmark inputs, coordinate fields. Emits the write `location` object. |
| **`DirectionsButton`** | Renders only for `exact` + coordinates; builds the URL (§12). |
| **`LocationSection`** | The composed detail-page block (facts + map + directions + privacy copy) used by Business, Food, Property, Tutor and Provider pages — one implementation, no per-domain map components. |

### 11.1 Public detail UX

| Mode | What the page shows |
|---|---|
| **exact** | "Location" section: address, landmark, block; map with a pin; **Get Directions**. |
| **approximate** | "Approximate location": block and a labelled, illustrative circle on the map; no address, no directions. |
| **area_only** | The area (and block) as text — **no map and no fake marker**. For a service provider this reads as its coverage area. |
| legacy rows (§3.1) | Same as `area_only`: the stored `area` text exactly as before. |

Search cards *display* the area and block as text (their payload also carries the public coordinates for a future map mode, §14).

### 11.2 Map picker (provider and admin forms)

- A map is shown in the form; **click / tap places the pin, dragging moves it**; latitude and longitude update the form state.
- `block`, `address` and `landmark` remain **explicit inputs**. A pin does not guarantee a correct postal address, so nothing is derived from it.
- **Keyboard and assistive-technology path (required):** visible latitude / longitude inputs with validation, a "Place pin at map centre" button, and a "Clear pin" button; the map itself is supplementary. Marker moves announce the new coordinates in a live region.
- Mobile: the map has a fixed, modest height with page gutters so a vertical swipe on the page still scrolls; the picker never traps focus or scroll.
- **No geolocation prompt in V1.** "Use my location" is deferred (privacy prompt, permission handling, accuracy) and needs explicit approval.
- Visibility selector copy states plainly what each option shows to the public; the default per kind follows §6.

## 12. Get Directions

`buildDirectionsUrl({ latitude, longitude })` returns
`https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>` (coordinates formatted to ≤ 6 decimals, URL-encoded). This is Google's documented cross-platform URL; it needs **no API key and no Google Cloud project**, and has nothing to do with the Google OAuth client. It is opened with `target="_blank" rel="noopener noreferrer"`. It is built **only** from public coordinates of an `exact` listing; for any other mode the button is not rendered and no URL is built.

## 13. Geocoding, reverse geocoding, indexing

- **Geocoding:** none in V1 (manual address + manual pin) — no provider billing, rate limits, API keys or query-privacy concerns. Autocomplete or address search can be added later behind a `Geocoder` interface in the picker only; the stored data model does not change.
- **Reverse geocoding:** not used; selecting a pin never rewrites the address.
- **Indexes in `0005`: none new.** `area` keeps its partial index (`ix_listings_approved_area`); there is **no latitude/longitude B-tree** (a B-tree on a coordinate pair serves neither radius nor bbox well, and the approved set is small). When a `block` filter ships, add `(area, block) WHERE status = 'approved'` (its `area` prefix makes the current index redundant). Spatial indexing arrives only with PostGIS (§14).

## 14. Future: map search, near-me, PostGIS

- **List | Map search:** `GET /search/map?bbox=minLng,minLat,maxLng,maxLat&…` (same filters as `/search`) returns slim pins `{id, kind, title, category, publicCoordinates}` capped at a fixed maximum, from `public_latitude/longitude` of **approved** listings that have a public point (`area_only` listings are absent from the map but present in the list). Clustering starts client-side (grid) and moves server-side (a snapped-grid `GROUP BY` on the public columns) only if pin counts demand it.
- **Near me / distance / radius:** the browser supplies a position (a later, separately approved feature); the server computes great-circle distance from `public_*` with a bounding-box pre-filter. A distance sort or radius filter **never** uses the exact point.
- **When PostGIS:** adopt it only on evidence — roughly an approved-listing count in the tens of thousands, measured `p95 > 100 ms` for radius/bbox queries on the plain columns, or a requirement for service-area polygons. The path is additive: enable the extension, add a generated `geography(Point, 4326)` column from `public_*`, add a GiST index, switch the query. No stored data changes.

## 15. Fixtures

`scripts/dev_fixtures.py` (development / test / staging only; it refuses production) gains an **explicit, idempotent demo-location step** that is separate from — and never part of — the migration:

- **Keyed by the fixed fixture UUIDs only**: a static table maps each fixture id to its new `area` (`B-17`), `block` (the letter already shown in that fixture's demo string, e.g. `Block C` → `C`), a synthetic demo `address`, a `location_visibility` and a coordinate. No other row is touched, and nothing is derived by parsing arbitrary data.
- Coordinates are **synthetic**: a deterministic grid of offsets (a few hundred metres apart) around one `FIXTURE_CENTER` constant documented as a *placeholder* — not B-17's real centre and not tied to the fictional names. The set covers all three modes (exact for businesses / food / property; approximate for one tutor; area-only for providers and another tutor).
- **Deliberately legacy fixtures remain**: at least one Property and one General business keep their old `area` string, `area_only` and no point, so the transitional path (§3.1) stays covered by tests.
- Re-running the loader on an already-seeded database applies the step (so an upgraded dev database gets demo locations) and refreshes `search_document` for the rows it changed. Existing tests that asserted the old fixture `area` strings are updated in slice 12B.
- No real private person's or business's location is ever recorded.

## 16. Test plan

**Privacy matrix (PostgreSQL, 12B and extended in 12D).** For each of `exact`, `approximate`, `area_only`, assert on **every surface** — `GET /search` (cards), `GET /listings/{id}`, `GET /search/suggestions`, the stored `search_document`, the owner endpoints, the admin endpoints, the OpenAPI schemas, the request log:

| Surface | exact | approximate | area_only |
|---|---|---|---|
| public detail | exact coordinates + address + landmark | rounded coordinates only; **no** address / landmark / exact point | no coordinates, no address |
| public card | exact coordinates (no address) | rounded coordinates | none |
| `search_document` | contains address / landmark | contains neither | contains neither |
| suggestions | no location text | no location text | no location text |
| owner / admin | full + `publicLocation` | full + rounded `publicLocation` | block (+ address if given) |
| another owner | `404` | `404` | `404` |

Plus: the generated public columns equal `round(exact, 2)` / exact / `NULL` for every mode (also asserted in a migration test); the `ck_listings_visibility_matches_point` and range constraints reject bad rows at the database; the public repository **raises** if a private attribute is touched and its compiled SQL never selects `latitude`, `longitude`, `address` or `landmark`; the serializer is a pure function with its own unit test; and the **narrowing matrix of §7.4** (below).

**Narrowing matrix (slice 12D; also in the write-security matrix, `AUTH_RBAC.md` §22.6).** On an `approved` listing, assert status, `revision`, the history rows, `submitted_at`, `search_document` and the stored columns after each request:

| Request | Result |
|---|---|
| `exact → approximate`, nothing else different (full form re-sent unchanged) | stays `approved`; `revision` + 1; **no history row**; `submitted_at` unchanged; address / landmark leave `search_document`; stored point identical |
| `exact → area_only` (point cleared, nothing else different) | stays `approved`; point is `NULL`; address / landmark still stored but not public; no history row |
| `approximate → area_only` (point cleared) | stays `approved`; no history row |
| the same three on a `pending` / `rejected` listing | status unchanged (no resubmission); no history row |
| any narrowing **plus** a moved pin (even by one unit of the 6th decimal) | `pending`; one `resubmitted` row (`approved → pending`) |
| any narrowing **plus** a changed `area`, `block`, `address` or `landmark` — or one of them *cleared* | `pending` |
| any narrowing **plus** a changed title / description / tag / image / category / price / bedrooms / furnishing / Food field / menu item | `pending` |
| `approximate → exact`, `area_only → approximate`, `area_only → exact` (alone) | `pending` |
| `exact → exact` with a moved pin or new address | `pending` |
| whitespace-only / case-only differences that normalise to the stored value | no-op, `200`, nothing written |
| any of the above with a stale `revision` | `409 listing_conflict`, nothing written |
| any of the above by a non-owner | `404`, nothing written |

**Legacy-migration tests** — §3.1 (slice 12B).

**Validation:** latitude / longitude range (exactly `-90..90` / `-180..180`, nothing narrower), both-or-neither, strings and `NaN` / `Infinity` rejected, more than 6 decimals rounded, `area` against `LOCALITIES` (`unknown_locality`), per-kind requiredness table (§6) row by row, `area_only` with a point rejected, `exact` without address rejected for business / property, malicious `block` / `address` text (control characters, over-length) rejected.

**Frontend (Vitest / RTL, no network):** `MapView` with a **fake engine** for exact / approximate / area-only; `LocationPicker` placing and moving a pin through the engine, typing coordinates, clearing, validation messages, visibility copy, keyboard-only completion; `DirectionsButton` URL generation (formatting, encoding, absence for non-exact); `LocationSection` per kind; an accessibility test that the coordinate inputs work without the map. **Playwright:** tile hosts are stubbed with a 1×1 PNG (`page.route`) and `VITE_MAP_TILE_URL` points at a local stub in the E2E build, so no run depends on a live tile server; mobile-viewport specs check the picker does not trap scrolling.

**CI:** nothing in backend or frontend CI contacts a tile, geocoding or maps provider.

## 17. Phase 12 location definition of done

Phase 12 is **not complete** unless: the location columns and constraints exist (`0005`); the write API accepts valid locations and rejects invalid ones; privacy is enforced server-side on every surface in §16; a provider or admin can place and edit a pin in the listing form; the public detail page renders the permitted map; Get Directions works for exact public locations; Property uses real stored locations; Business and Food use real stored locations; the reduced-visibility behaviour exists for Tutor / Provider kinds; CI does not depend on a live tile provider; and future map search / near-me remain feasible without a schema redesign.

## 18. Open items and future enhancements (none blocks 12B)

**Open product decisions**

1. **Production tile provider** — chosen at deployment time (`DEPLOYMENT.md` §11).
2. **Contact channel** (O-3) — directions do not solve "how do I reach the business". **Must be resolved before the Phase 12F implementation is finalised** (`API_CONTRACT.md` §10.8); nothing contact-related is designed or built in 12A.

**Future enhancements (recorded, not scheduled)**

- **Geographic validation** — a B-17 bounding box or polygon, swapped latitude/longitude and null-island detection — when authoritative geographic data exists (§5).
- A managed `areas` / `blocks` lookup (O-1) and cleanup of legacy `area` strings (§3.1).
- The validated `ck_listings_property_has_point` rule once the legacy drift query returns zero everywhere (§3.1).
- Geocoding / address autocomplete, "use my location", map search, near-me, PostGIS (§13–§14).

## 19. Implementation notes — Phase 12B as built

Source: `backend/alembic/versions/0005_listing_location.py`, `app/models/listings.py`, `app/schemas/read.py` (`LocationRead`, `CoordinatesRead`), `app/services/read_mappers.py` (`map_location`), `app/repositories/listing_reads.py`, `app/services/search_document.py`, `app/services/search_index.py`, `scripts/dev_fixtures.py`. Nothing frozen in §1–§18 was changed; this records how it was realised and the few places the implementation had to choose.

1. **Migration `0005`** is DDL only (no `UPDATE` / `INSERT`; asserted by an offline-SQL test) and carries the generated-column SQL verbatim. The expression is written in PostgreSQL's own normal form (`'exact'::text … ELSE NULL::numeric`) so Alembic's crude computed-column comparison reports no drift and no warning.
2. **ORM guard.** `latitude`, `longitude`, `address`, `landmark` are mapped `deferred=True, deferred_raiseload=True` — secure by default: any code that touches one without loading it explicitly raises (`InvalidRequestError`). Public repositories never load them; the indexing loader `undefer`s only `address` / `landmark`, never the point.
3. **Public address / landmark.** Instead of loading the private columns and filtering in Python, public detail queries use `with_expression` to select `CASE WHEN visibility = 'exact' THEN address END` into the query-only attributes `public_address` / `public_landmark`; the address of a non-exact listing is never selected. (Tests strip those guarded `CASE` fragments and assert no raw private column remains in the compiled SQL.)
4. **Wire shape.** The frozen nested form of §8 was implemented (`area` top-level, `location.coordinates{latitude, longitude, precision}`), not the flat sketch in the 12B brief. Floats are JSON numbers (converted from the `NUMERIC` values in the mapper); `by_alias` / `exclude_none` apply, so absent values are omitted.
5. **`SearchIndexer.refresh`** now flushes and re-reads the listing through the indexing loader (with `populate_existing`), so callers that obtained the instance any way — including a plain `session.get` whose private columns are unloaded — can never trip the raiseload guard or index stale values. Application-maintained, no trigger, nothing runs at startup.
6. **Not part of 12B (deferred to the slice that needs it):** the `LOCALITIES` setting and per-kind requiredness (write validation, 12D); the new error codes (12D); owner / admin location shapes and routes (12D/12E — no fake endpoint was added); the `block` filter and its index (not introduced); frontend and map UI (12G/12H).
7. **Fixtures.** `DEMO_LOCATIONS` (ten fixtures: exact / approximate / area-only, including private addresses used by the leak tests and two non-public located listings) and `LEGACY_FIXTURE_IDS` (five, kept legacy). The step runs on every loader run, is idempotent, and is the only place `area` is ever set to `B-17`. Tests that asserted the old fixture area strings now distinguish `LEGACY_PUBLIC` from `MODERN_PUBLIC`.
8. **Search-index CLI vs. old schemas.** Because the ORM now maps the new columns, `python -m app.db.search_index` needs a database at `0005`; the old "stop at 0002, then rebuild" upgrade-path tests were changed to upgrade to head first, which is also the real release order (`alembic upgrade head` → rebuild if needed → check).

## 20. Implementation notes — Phase 12D as built (write validation)

Nothing frozen in §1–§18 changed. Source: `app/services/listing_state.py` (pure rules), `app/services/listing_writes.py`, `app/repositories/owner_listings.py`, `app/services/owner_mappers.py`.

1. **Requiredness (§6) is enforced on the RESULTING state of every create and every effective edit**, with these details codes: a missing `location` block → `required` on `location`; a block without `visibility` → `required` on `location.visibility` (except provider / tutor, which default to `area_only`); `exact` / `approximate` without a coordinate → `required` on `location.latitude` / `location.longitude`; `area_only` with a coordinate → `not_allowed` (it is never silently dropped); `exact` without an address → `required` on `location.address` **for every kind** (the table's "required when exact"); a Property with `area_only` → `not_allowed` on `location.visibility`.
2. **Coordinates** are JSON numbers (strings, booleans, `NaN` / `Infinity` rejected by the schema), rounded half-even to 6 places, then range-checked (`out_of_range`). No geofence, no geocoding. The public columns are never writable: `publicLatitude`, `publicLongitude` and `coordinates` are undeclared keys → `not_allowed`.
3. **`block`** is 1–40 characters of letters, digits, space, `-`, `/`, `.` starting with a letter or digit (`invalid_format` otherwise); `address` ≤ 200 and `landmark` ≤ 100 printable characters; blank text is "absent".
4. **`area`** is validated against `LOCALITIES` whenever it is supplied (`unknown_locality`); it is stored in the configured spelling. An edit that omits it leaves a legacy value untouched. A legacy Property (area-only, no point) cannot be edited effectively without gaining a valid location (`required` / `not_allowed` until it has one) — but a no-op PATCH, an archive and the owner reads work on it.
5. **The narrowing predicate (§7.4)** is `listing_state.is_pure_narrowing`: one of the three narrowings, every other moderated value equal (title, description, tags, image, `area`, `block`, `address`, `landmark`, category, every subtype field, the whole Food profile), `latitude` / `longitude` identical for `→ approximate` and `NULL` for `→ area_only`. Anything else — including a one-unit move of the pin, or clearing the address — is an ordinary edit. The §16 narrowing matrix is tested row by row through the HTTP API on real PostgreSQL (status, revision, history rows, `submitted_at`, the search document and the stored columns).
6. **Owner reads** load the private columns through a separate repository (`OwnerListingRepository`, `undefer`) behind an `owner_id = :principal` predicate; the public `ListingReadRepository` and its `raiseload` guard are untouched. `publicLocation` in an owner shape is produced by the public mapper, so it is exactly what an anonymous visitor gets.
7. **Search:** every write that changes content or location refreshes `search_document` in the same transaction; a narrowing removes the address / landmark immediately; a widening or any material edit returns the listing to `pending` (so it leaves the public API until re-approved).
