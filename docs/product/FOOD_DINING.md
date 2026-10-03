# Food & Dining — Product / Architecture Source of Truth

Scope: the **Food & Dining** frontend/product vertical only. It is a bounded, discovery-first, free-first expansion of the existing Business Directory. Other documents remain authoritative for their own areas: `docs/design/DESIGN_SYSTEM.md` (visual rules), `docs/development/ROADMAP.md` (phase order), `docs/development/CURRENT_STATE.md` (implementation status), `docs/development/DECISIONS.md` (decision log). This file does not repeat them.

Status: **architecture frozen; FD1 implementation COMPLETE** (FD2 is next; FD2–FD5 are not implemented).

---

## 1. Positioning

Food & Dining is a **specialized vertical of the existing Business domain**.

It is **not**: a separate application, a separate top-level listing kind, a separate Professional dashboard, a separate Admin system, or a separate Saved-item kind.

Core V1 journey:

```
Discover → Search / Filter → View Food Business → Inspect profile / menu preview → Save → Call / WhatsApp
```

The current phase is **free and discovery-first**. A useful basic Food profile never requires Premium. "Call / WhatsApp" means the existing simulated contact actions already used by `BusinessCard` and the Business detail page (no real contact data is introduced).

## 2. What Food reuses

| Existing system | Reuse |
|---|---|
| `Business` record, `BusinessCard`, `BusinessProfilePage` (`/businesses/:id`) | The only card and the only detail implementation; Food adds conditional sections |
| `src/services/search.ts`, `SearchPage`, `FilterControls`, predictive suggestions | One search engine, one results screen |
| `listingsStore`, `PendingListing { kind: "business" }` | One listing lifecycle, no Food store |
| Professional Workspace (ownership, Free quota, edit, resubmit, archive, summaries) | Unchanged |
| Admin moderation queue and `ReviewPanel` | Unchanged flow; Food metadata is displayed |
| Saved reference `{ kind: "business", id, savedAt }` | Unchanged |
| `CardImage` / `PlaceholderImage` fallback | Unchanged |

## 3. Domain model

```ts
Business {
  ...existing fields
  vertical: "general" | "food"
  food?: FoodProfile            // present only when vertical === "food"
}

FoodProfile {
  categories: FoodCategorySlug[]          // 1–3; first is the primary category
  serviceOptions: FoodServiceOption[]
  hoursNote?: string                      // display text only
  menuHighlights?: MenuHighlight[]        // discovery only; practical cap ≈ 8
  menuImage?: string
}

MenuHighlight {
  id: string
  name: string
  section?: string
  description?: string
  price?: string                          // informational display string, never parsed
}
```

Rules:

- `vertical` is **explicit**. During FD1 every existing general Business record (static seed, the pending-listing seed, and records produced by the onboarding builder) is migrated to `vertical: "general"`. If the migration needs a temporary `vertical?` (undefined = general), that is **transitional only** and must be tightened to required before FD1 is complete.
- The model stays intentionally small. **Not added now:** a `cuisineTags` field (existing Business `tags` hold cuisine/search words), logo, gallery, structured weekly hours, menu-item images, cart/order fields, inventory, delivery tracking.
- Image fields keep the current convention (optional string). The null-vs-omitted API convention in `DECISIONS.md` still applies at the future API boundary.

### Primary category compatibility

`Business.category` remains the **display label of the primary Food category**: `food.categories[0]` is the primary, and `Business.category` is **derived** from the canonical taxonomy label (by the seed data and the onboarding builder) — the user never types a separate, possibly conflicting value. There must not be two independent sources of truth. This keeps `BusinessCard`, search mapping, suggestions, Saved subtitles and moderation labels working unchanged.

## 4. Taxonomy (config, not free text)

Planned location: `src/config/food.ts` (static app configuration, like `serviceCategories`).

| Slug (canonical ID) | Label |
|---|---|
| `restaurants` | Restaurants |
| `fast-food` | Fast Food |
| `biryani-rice` | Biryani / Rice |
| `bbq` | BBQ |
| `pizza-burgers` | Pizza / Burgers |
| `cafes` | Cafes |
| `juice-shakes` | Juice / Shakes |
| `bakeries` | Bakeries |
| `sweets-desserts` | Sweets / Desserts |
| `desi-food` | Desi Food |
| `tea-snacks` | Tea / Snacks |

Slugs are stable IDs; labels are presentation. A business selects **1–3** categories, the first being primary. Food records never accept a free-text category. Adding a category is primarily a config change.

### Service options (also config)

| ID | Label |
|---|---|
| `dine-in` | Dine-in |
| `takeaway` | Takeaway |
| `delivery` | Delivery by the business |

`delivery` means delivery offered and arranged **by the individual business**. It must never imply that B-17 Portal provides riders, delivery logistics, tracking or fulfillment, and the Food detail page must say so plainly (e.g. "Delivery, where offered, is arranged directly with the business; B-17 Portal does not deliver.").

## 5. Routing

| Route | Role |
|---|---|
| `/food` | First-class Food & Dining discovery landing page |
| `/businesses/:id` | The **single canonical detail route**; Food businesses use the existing Business detail with conditional Food sections |

`/food/:id` is **not built** in this expansion. A future marketing alias may redirect it to the canonical Business route; it must never become a second detail implementation. The mobile bottom nav keeps its 5-destination limit; Food gets entry points through Home, the Directory, desktop navigation and the footer.

## 6. Search contract

Food does **not** introduce a new `SearchResultKind`; results remain kind `business`. The public URL/search contract is:

```
type=business
vertical=food
foodCategory=<slug>
service=<service-option>
```

Example: `/search?type=business&vertical=food&foodCategory=fast-food&service=takeaway`

- Searchable Food content: Business name, description, area, Business `tags`, Food category labels and menu-highlight names. **Ranking is unchanged.**
- Predictive suggestions stay grounded in searchable data, and selecting a suggestion must resolve to matching results (the Visual V2.1 rule).
- The new filter keys join the existing URL filter plumbing so that switching Search type clears them like every other type-specific filter, and the URL remains the committed search state.
- A future `type=food` may exist only as a UI/URL alias resolving internally to `type=business` + `vertical=food`. It must not become a domain kind.
- Backend-ready shape: `GET /search?type=business&vertical=food&food_category=…&service=…`.

## 7. `/food` discovery experience

A landing page built from existing design-system patterns, following the established category-landing pattern (it links into the Search system; it does not own a results engine):

1. Page title and short introduction
2. Scoped Food search entry
3. Category discovery (the taxonomy tiles)
4. Service-option shortcuts/filters where useful
5. Featured businesses — **only** where the existing `featured` flag is true
6. Empty and recovery states, with real actions
7. Links into the existing Search results

No independent Food result engine. **Never fabricate:** popularity, ratings, reviews, "best", trending, delivery times, distance, open-now.

## 8. Menu, hours and media

- **Menu:** both an optional `menuImage` and a small set of structured `menuHighlights` (name, optional section/description/price). Price is a display string with a demo-data notice. No quantity, cart, add-to-order, stock, option groups, modifiers or checkout fields. Highlights exist for discovery only.
- **Hours:** `hoursNote?: string` (e.g. "Mon–Sun, 12 PM–11 PM"). No structured per-day model and no "Open now" logic — that avoids false, time-dependent claims before real merchant data and backend rules exist.
- **Media:** `Business.image` stays the main cover image; `menuImage` is optional; the current `CardImage` / `PlaceholderImage` fallback is reused. No gallery, logo, upload/storage backend, CDN work or per-menu-item images. No fake photos (demo records use the placeholder unless a real asset exists).

## 9. Directory migration rule

Existing records that overlap Food move to the Food vertical. **Capital Bakers** (`business-06`, currently category "Bakery") becomes `vertical: "food"` with primary category `bakeries`. The general Directory must not show the same business or category twice: Food businesses live under Food discovery while remaining Business records, and the Directory points to `/food` instead of duplicating Food tiles.

## 10. Onboarding / Professional

The Professional Workspace is reused as-is. The listing journey stays conceptually:

```
Business → choose Business vertical → General Business | Food & Dining
```

Choosing Food & Dining reveals Food fields (categories, service options, hours note, menu highlights, optional menu image). Reused unchanged: listing lifecycle, ownership, the Free quota (pending + approved), edit, resubmit, archive, summaries. **Not created:** a Restaurant/Food dashboard or a separate Food store. The submitted listing is still `PendingListing { kind: "business", data: Business }`.

## 11. Admin moderation

Food listings use the existing queue, statuses and Approve/Reject flow; moderation business logic is unchanged. Admin may additionally display Food identity, selected categories, service options, hours note, menu-highlight count and menu image. No separate Food moderation system.

## 12. Resident / Saved

Food businesses stay saved as `{ kind: "business", id, savedAt }` — no new Saved kind. A later UI refinement may group them as "Food & Dining", but the stored identity stays Business. No Food request or order flow is added.

## 13. Future backend mapping (high level only)

```
businesses ──1:0..1── food_profiles ──1:many── food_menu_items
```

The API may still embed `business.food` for convenience; the filters above map one-to-one to query parameters; moderation would create the business and its food profile together. This document does not design the full schema.

## 14. Free-first scope

The current release supports: business identity, Food categories, description, area, cover image, tags, service options, hours note, menu highlights, optional menu image, Save and Call/WhatsApp. Nothing here is gated behind Premium.

## 15. Future directions — reserved, NOT implemented

**Monetization (possible later):** Premium storefront/profile, featured/sponsored placement, merchant analytics/tools, promotions/offers, in-platform transaction commission. Principle: **Premium subscription and transaction participation are separate concepts** — a future business might independently have `plan: free | premium` and `orderingEnabled: true | false`. Neither field is added to the FD1 model unless existing architecture already requires it. No pricing or commission figures are defined here.

**Ordering (possible later):** Discovery → Menu → Order → Fulfillment → Payment/Settlement, with delivery either by the merchant or by B-17/a partner. The current expansion must not implement any of it (see §16). Today's design should not block these capabilities, but must not pre-build them.

## 16. Explicitly out of scope (this expansion)

Cart · online ordering · checkout · payment · commission logic · settlement · refunds · order tracking · portal-managed delivery · rider management · reviews · ratings · fake popularity · delivery estimates · distance · open-now · map · structured per-day hours · gallery · logo upload · cuisine facet system · a new `SearchResultKind` · a Food-specific store · a Food-specific dashboard · a separate Food Admin · `/food/:id` · backend implementation · route-level code splitting · PWA changes.

## 17. Architectural non-negotiables

- Food is Business.
- No duplicate Food store.
- No duplicate detail implementation.
- No separate Admin; no separate Professional Workspace.
- No new Saved kind; no new Search result kind.
- Canonical, config-backed taxonomy; one primary Food category with a single source of truth.
- Ordering remains future; delivery is merchant-provided unless explicitly stated otherwise.
- No fake trust or popularity data.
- Backend-ready, but frontend-first.

## 18. Implementation phases

One phase = one independently reviewable commit.

| Phase | Scope |
|---|---|
| **FD1 — Domain / Data / Search Foundation** | Food types/model; category and service-option config; demo Food data; migrate overlapping records (and set explicit `vertical` on all existing Business records); Search filters, URL filter plumbing, search mapping, predictive-suggestion integration; Food filter controls. No Food landing or detail redesign yet |
| **FD2 — Food Discovery** | `/food` landing; category discovery; scoped entry into Search; service-option discovery; real Featured handling; Home / Directory / nav / footer entry points; no duplicate results engine |
| **FD3 — Food Detail Experience** | Conditional Food sections on `BusinessProfilePage`: service options, delivery clarification, hours note, menu highlights, menu image; Food presentation refinements; optional Saved presentation refinement |
| **FD4 — Listing / Professional / Admin Integration** | Food & Dining listing selection; `FoodListingFields`; validation; builders; edit prefill; Professional listing presentation; Admin Food metadata/review presentation |
| **FD5 — QA / Accessibility / Docs** | Search V2.1 regression; responsive 320/375/430/820/1024/1440; Saved; Professional quota/lifecycle; moderation; accessibility; empty states; long/missing data; docs sync; final Food review |

### Implementation status

| Phase | Status |
|---|---|
| FD1 — Domain / Data / Search Foundation | **COMPLETE** (FD1 commit: pending) |
| FD2 — Food Discovery | Next — not implemented |
| FD3 — Food Detail Experience | Not implemented |
| FD4 — Listing / Professional / Admin Integration | Not implemented |
| FD5 — QA / Accessibility / Docs | Not implemented |

**FD1 now provides:** explicit `Business.vertical` (`general | food`) on every Business record; the optional `FoodProfile` and `MenuHighlight` types; canonical, config-backed Food categories and service options in `src/config/food.ts`; `Business.category` derived from the primary (first) Food category label; 10 demo Food businesses including the migrated Capital Bakers (`business-06`, now Food / Bakeries); Food remaining `SearchResultKind` `business`; the Search filters `vertical`, `foodCategory` and `service`; Food category labels and menu-highlight names as searchable text; predictive suggestions that resolve to actual Business results; URL state that validates the canonical Food filter values (unknown values are ignored); a general Directory currently scoped to general businesses; and Saved, Professional and Admin reused unchanged.

**Not yet implemented (FD2+):** the `/food` landing page and entry points, Food-specific detail sections, a Food-specific card presentation (Food still renders through the generic `BusinessCard`), Food onboarding, and Admin Food metadata.

**Implementation note — until FD4:** Food onboarding is not available, and the existing general Business builder (`buildBusiness`, which creates `vertical: "general"`) must **not** be considered Food-safe. FD4 must preserve `FoodProfile` through create, edit and resubmit so a Food listing never loses its Food data.

New files are expected only where justified: `src/config/food.ts` (taxonomy), `src/features/food/` (the landing page), and the Food form/detail sections. No `FoodCard`, no `FoodDetailPage`, no Food store.
