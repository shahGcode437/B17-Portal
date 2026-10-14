# B-17 Portal — Read API parity with the frontend (Phase 10D)

**Status:** implemented in Phase 10D (`backend/app/api/v1/{categories,search,listings,news}.py`). The generated OpenAPI document (`/api/v1/openapi.json`, non-production) is the machine-readable contract; [`API_CONTRACT.md`](API_CONTRACT.md) §4–§6 holds the conventions; this file records **how the backend reads match the frontend's `src/services/search.ts` and where they deliberately differ**, so Phase 12 (frontend integration) starts from facts rather than guesses.

The frontend does not call these endpoints yet. Nothing here changes any frontend behavior.

## 1. Endpoints

| Endpoint | Returns | Notes |
|---|---|---|
| `GET /api/v1/categories?module=` | `data: Category[]` | Active categories only, ordered by module, display order, slug. `module` ∈ `services · food · directory · property · education · news`. (The 10A sketch had an `active` parameter; public reads only ever list active categories, so it was not added.) |
| `GET /api/v1/search` | `data: SearchHit[]`, `meta: {total, limit, offset}` | `SearchHit = {kind, item}` — `kind` ∈ `provider · business · tutor · property · news`. |
| `GET /api/v1/search/suggestions?q=&type=&limit=` | `data: Suggestion[]` | `limit` 1–20, default 8; `q` shorter than 2 characters → `[]`. |
| `GET /api/v1/listings/{id}` | `data: ListingDetail` | Discriminated on `kind`. Food businesses include the full `food` section with `menuHighlights`. |
| `GET /api/v1/news?kind=&limit=&offset=` | `data: NewsItem[]`, `meta` | Newest `publishedAt` first. |
| `GET /api/v1/news/{id}` | `data: NewsItem` | `id` is a UUID (news has no separate public slug). |

`/search` query parameters use the frontend's Search URL keys: `q`, `type`, `area`, `category`, `subject`, `grade`, `bedrooms` (minimum, 1–20), `furnished`, `listingType`, `propertyType`, `vertical`, `foodCategory`, `service`, `sort` (`default | newest`), `limit` (1–50, default 12), `offset` (0–100000). Invalid values (`type=pharmacy`, `vertical=retail`, `service=curbside`, `limit=100`, `bedrooms=0`) are a `422 validation_error` envelope with per-field `details`. Finite-choice filters are **validated**: absent (or blank) = no filter, a known value = apply it, an unknown value = `422 validation_error` (`details[].field` names the parameter) — never a silently broader query. Open-data and free-text parameters (`q`, `area`, `grade`, `category`, `subject`, `propertyType`, `foodCategory`) are not validated against a value list: an unknown value matches nothing.

## 2. Visibility (the public boundary)

Only **approved** listings and **published** news are readable. Everything else — pending, rejected, archived, draft, a random UUID, a malformed id, a news id used as a listing id — answers the **same** `404 not_found` (identical body apart from `requestId`), so the API never confirms that a hidden record exists or why it is hidden. Hidden content is also absent from search, suggestions, totals and `search_document`-based matching (it is indexed but never served). Responses carry no owner, moderation reason, revision, history, timestamps or ids of internal tables.

## 3. Matching and ranking

* **Text match:** case-insensitive **substring** over one lower-cased `listings.search_document` (see `DATA_MODEL.md` §14.1) — `LIKE '%q%' ESCAPE '\'`. `%`, `_` and `\` typed by the user are escaped and matched literally; `q` is trimmed and capped at 100 characters; blank means "browse".
* **What is searched** — listing: title, category names (all of them), description (a tutor's bio), area, tags; Food: menu-item names; property: price text, "N bed", furnishing, "for sale"/"for rent"; tutor: grade. News (built in the query, no stored document): title, category name, summary, tags. Never: owner, e-mail, phone, reasons, history, status, menu prices, Food hours.
* **Ranking with `q` (deterministic):** by the **title** — exact (0), starts with (1), a word starts with it (2), contains it (3), matched only elsewhere (4) — then shorter title, then kind order, then lower-cased title, then id. Without `q` the browse order is kind order (provider → business → tutor → property → news), then creation time, then id. `sort=newest` puts dated news first (newest `publishedAt` first), then the browse order.
* **Totals** are computed in SQL over the same predicate (one `count`), pagination is `LIMIT/OFFSET` on a stable total order, and each page loads exactly the rows it shows with a fixed number of statements (eager loading — no N+1; asserted in tests).

## 4. Filters (kind-aware, copied from `matchesFilters`)

A filter narrows only kinds that **have** that field; other kinds are not excluded (so `grade=Grade 10` still returns providers, businesses, property and news, plus only the tutors of that grade). Scope with `type=` for a single-kind result.

| Filter | Applies to | Compared against |
|---|---|---|
| `area` | provider, business, tutor, property | exact `area` (news has none and stays) |
| `category` | provider, business, news | **primary category slug** (news: its category slug). The frontend passes display labels here; slugs are the API's vocabulary |
| `subject` | tutor | primary category slug |
| `grade` | tutor | exact grade text |
| `listingType`, `furnished` | property | exact |
| `propertyType` | property | primary category slug |
| `bedrooms` | property | `bedrooms >= n` (a property without bedrooms never matches) |
| `vertical` | business | `general` / `food`; **an unknown value is a 422** (the frontend ignored it; see §6 #10) |
| `foodCategory` | Food businesses | any of the listing's Food categories (slug); a General business never matches; an unknown slug matches nothing |
| `service` | Food businesses | `dine-in · takeaway · delivery`; **an unknown value is a 422** |

Food/General isolation: Food-only filters can never match a General business; `category=pharmacy` can never match a Food business; the module of every category link is enforced by the database (composite keys), so a Food category cannot be attached to a General business at all.

## 5. Suggestions

Built only from public searchable content so that selecting one always yields results. Candidate terms: category names, tags (first letter capitalised, like the frontend), Food menu-item names, tutor grades, "For Sale"/"For Rent", news categories/tags, and listing/news titles. Ranked like the frontend (exact → starts-with → word-prefix → contains, then shorter label, then alphabetical, then kind order); **one entry per `(kind, label)`** with a category/tag/menu term winning over an item title; bounded by `limit`; one SQL statement. `id` is `kind:term:<label>` for a term and `kind:item:<uuid>` for an item (stable, usable as a React key); `secondaryLabel` is the kind label (`Services`, `Directory`, `Education`, `Property`, `News`) plus, for an item, ` · <category>` (tutor ` · Physics · Grade 9`, property ` · House · For Sale`).

## 6. Deliberate differences from the frontend

| # | Frontend today | Backend | Why |
|---|---|---|---|
| 1 | Results have **no relevance order** (insertion order) | With `q`, title-first deterministic relevance | Required for a real result set larger than one page; ties are fully ordered, so the output is reproducible |
| 2 | A property's description is not searched (only its price line) | It is searched | The data exists and is public; users would expect to find "near the market" |
| 3 | `category` filter takes a display label | Takes a category **slug** | Labels are editable data once categories are dynamic; Phase 12 changes the frontend call |
| 4 | Whitespace is not normalised | Runs of whitespace collapse to one space in the document | Stable matching, cheaper index |
| 5 | Suggestion `id` is derived client-side | `kind:term:…` / `kind:item:<uuid>` | Items now have real ids |
| 6 | Natural browse order is the seed array order | Kind order, then creation time, then id | Seed order no longer exists; this is stable and documented |
| 7 | `featured` is `boolean?` | Present (`true`) only when featured, omitted otherwise | Matches the frontend's optional field; null/omitted rules in `API_CONTRACT.md` §1 |
| 10 | An unknown `vertical` / `service` is silently ignored | `422 validation_error` | An ignored value broadens the query without telling the client; closed sets are validated, open data (slugs, `area`, `q`) is not |
| 8 | Food detail menu is a field of the business | Detail includes `food.menuHighlights`; **search cards omit the menu** | Cards never need it; avoids loading menu rows per hit |

## 7. Known limits (honest)

* Substring search has no typo tolerance, stemming or synonyms; the trigram GIN index serves ≥3-character fragments best (shorter fragments scan the filtered set, which is small at B-17's scale). Full-text/trigram-similarity/PostGIS/a search engine are deferred until evidence demands them (`DATA_MODEL.md` §9).
* `search_document` is application-maintained. Every code path that edits a listing or renames a category **must** call `SearchIndexer` in the same transaction; `python -m app.db.search_index check` detects drift and `… rebuild` repairs it (also the required release step right after migration `0002`, which leaves existing rows with an empty document).
* News documents are computed at query time (a small, admin-authored table).
* No locale-aware collation: ordering uses lower-cased text.
* The two LOW Search UX findings in `docs/development/SEARCH_UX_FINDINGS.md` remain deferred (frontend-only).
