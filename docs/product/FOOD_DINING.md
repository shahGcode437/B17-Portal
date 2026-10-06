# Food & Dining — Product / Architecture Source of Truth

Scope: the **Food & Dining** frontend/product vertical only. It is a bounded, discovery-first, free-first expansion of the existing Business Directory. Other documents remain authoritative for their own areas: `docs/design/DESIGN_SYSTEM.md` (visual rules), `docs/development/ROADMAP.md` (phase order), `docs/development/CURRENT_STATE.md` (implementation status), `docs/development/DECISIONS.md` (decision log). This file does not repeat them.

Status: **architecture frozen; FD1, FD2, FD3 and FD4 implementation COMPLETE** (FD5 is next; FD5 is not implemented).

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
| FD1 — Domain / Data / Search Foundation | **COMPLETE** (commit `120720f`) |
| FD2 — Food Discovery | **COMPLETE** (commit `1af5cea`) |
| FD3 — Food Detail Experience | **COMPLETE** (commit `dd28411`) |
| FD4 — Listing / Professional / Admin Integration | **COMPLETE** (FD4 commit: pending) |
| FD5 — QA / Accessibility / Docs | Next — not implemented |

**FD1 now provides:** explicit `Business.vertical` (`general | food`) on every Business record; the optional `FoodProfile` and `MenuHighlight` types; canonical, config-backed Food categories and service options in `src/config/food.ts`; `Business.category` derived from the primary (first) Food category label; 10 demo Food businesses including the migrated Capital Bakers (`business-06`, now Food / Bakeries); Food remaining `SearchResultKind` `business`; the Search filters `vertical`, `foodCategory` and `service`; Food category labels and menu-highlight names as searchable text; predictive suggestions that resolve to actual Business results; URL state that validates the canonical Food filter values (unknown values are ignored); a general Directory currently scoped to general businesses; and Saved, Professional and Admin reused unchanged.

**FD2 now provides:**

- *Routing / discovery:* `/food` is live as the Food & Dining discovery landing page; `/businesses/:id` remains the single canonical Business/Food detail route; no `/food/:id` route was introduced.
- *`/food` experience:* one meaningful h1; a scoped Food search entry; config-driven category discovery; config-driven service-option shortcuts (with the "Delivery by the business" wording and a note that B-17 Portal does not deliver); a neutral "Food businesses in B-17" preview using the existing `BusinessCard` — there is no Featured section, because no Food record is `featured` (any record that really is flagged would sort first and show `BusinessCard`'s own badge).
- *Search:* `/food` delegates entirely to the existing Search engine. Category links use `type=business&vertical=food&foodCategory=<slug>`; service links use `type=business&vertical=food&service=<option>`. No duplicate Food result or search system; Search V2.1 behavior is preserved.
- *General Directory boundary:* general Directory tiles now navigate with `type=business&vertical=general&q=<category>`, so Food businesses cannot leak into General Directory searches even when their searchable text overlaps (verified with a temporary overlap test). Food & Dining has one dedicated Directory tile to `/food`; Food categories do not appear in the General Directory.
- *Entry points:* a Food & Dining tile on Home; a Directory tile; a "Food" link in the desktop navigation (the header was tightened so six links fit at 1024px); a "Food & Dining" footer link. The mobile bottom nav is unchanged at five destinations by design.
- *Quality:* no dependency added; TypeScript clean; build succeeds (JS ≈ 869 KB); lint at the 8-warning baseline; fresh console clean; responsive verified at 320 / 375 / 430 / 820 / 1024 / 1440.

**FD3 now provides:**

- *Detail architecture:* `/businesses/:id` remains the only canonical Food Business detail route. `BusinessProfilePage` conditionally composes the Food sections (via `FoodDetailSections`) when `vertical === "food"`; no `FoodDetailPage` and no `/food/:id` route was created, and the shared `DetailLayout` primitives are reused.
- *Food identity:* a Food & Dining badge is visible on Food Business details. `Business.category` remains the primary category label (the subtitle); additional categories appear as secondary "Also serves" information. All labels stay config-driven.
- *Service options:* the canonical service options are shown. Delivery is explicitly described as arranged by the business, and B-17 Portal is explicitly not presented as the delivery provider.
- *Hours:* `hoursNote` is display-only free text — no Open Now logic and no structured weekly-hours model.
- *Menu:* informational menu highlights are supported; the optional section / description / price fields render conditionally, and prices are display strings (the detail page caption is neutral: "Prices shown are for reference and may change."). There is no cart, order, quantity or checkout behavior. An optional `menuImage` is supported through the existing image system. Every Food section is omitted when its data is absent.
- *Compatibility:* `BusinessCard` remains generic; Saved storage remains `kind: "business"`; General Business details are unchanged; Search behavior is unchanged; Food onboarding, edit and Admin work remain FD4.
- *Quality:* responsive verified at 320 / 375 / 430 / 820 / 1024 / 1440; one meaningful h1 and a logical heading order; semantic lists and decorative-icon handling verified; visible focus verified; TypeScript clean; build succeeds; lint at the established 8-warning baseline; fresh console clean; JS ≈ 871 KB; no dependency added.

**FD4 now provides:**

- *Onboarding:* Food remains listing kind `"business"` (`vertical: "food"`); no fourth listing kind was introduced. Business onboarding offers a "Business type" choice — General Business or Food & Dining — and the Food-specific fields appear only for Food. Switching types keeps what was typed; Food → General discards the Food data when saved.
- *Food form (`FoodListingFields`):* 1–3 canonical Food categories (the first selected is primary; a "Make primary" control reorders); **at least one canonical service option is required (frozen decision)**; an optional hours note; up to 8 menu highlights (name required, section / description / price optional); an optional menu image. Category and service labels remain config-driven.
- *Category:* `Business.category` is derived from the primary Food category (`deriveFoodCategory`); a Food listing never has a separately typed category, so no second editable Food category source exists. General Business keeps its existing free-text category.
- *Builder / validation:* `buildBusiness` now builds General or Food (the form-values type makes "Food without `FoodProfile`" unrepresentable); Food fields are validated by a dedicated schema with linked, accessible errors.
- *Lifecycle:* `FoodProfile` survives create → pending → reject → edit → resubmit → approve → archive. Edit prefills the whole profile (and keeps typed values when returning from the preview). The quota and lifecycle remain the existing Business rules (pending + approved count; rejected and archived do not).
- *Professional:* the existing Professional Workspace is reused; Food listings are labelled "Food & Dining · <categories>" with a Food icon, and the create/edit preview and "View" dialog show a shared Food summary. No Food dashboard, analytics or orders.
- *Admin:* the existing moderation queue is reused. Food identity and categories are visible in the queue; the review panel shows Food categories, services, hours, menu highlights and the menu image where present. Moderation rules are unchanged.
- *Public:* approved Food listings appear naturally in Search (name, primary / secondary category, menu-item name, `service` and `vertical=food` filters) and use the FD3 Food sections on `/businesses/:id`; Saved remains `kind: "business"`.
- *Price copy:* the menu-price caption is neutral for both seed and merchant-submitted data: "Prices shown are for reference and may change."
- *Quality:* General Business regression clean; responsive verified at 320 / 375 / 430 / 820 / 1024 / 1440; keyboard focus verified; TypeScript clean; build succeeds (JS ≈ 888 KB); lint at the established 8-warning baseline; fresh console clean; no dependency added.

**Not yet implemented (FD5):** the QA / accessibility / docs closing phase; a Food-specific card or Saved presentation (Food still renders through the generic `BusinessCard`); a warning when a Food listing is switched to General.

**FD4 known limitations:** cover and menu images remain browser-local under the current frontend prototype; Food → General intentionally discards Food-specific data when saved (consider a warning during FD5); Food cards / Saved remain generic Business presentation; backend persistence and storage are not implemented; no automated test suite exists.

**FD3 known limitations:** no permanent demo `menuImage` currently exists (the rendering was verified with a temporary test value only); hours remain free text; the generic `BusinessCard` / Saved presentation remains; Food cannot yet be created or edited through onboarding; the existing large-chunk build warning remains for future code-splitting work.

**FD2 known limitations:** the `/food` search box has no Food-scoped predictive suggestions yet (the Search page itself keeps full suggestions); the preview uses the existing static demo business source; there is no Food item in the mobile bottom nav, by design.

New files are expected only where justified: `src/config/food.ts` (taxonomy), `src/features/food/` (the landing page), and the Food form/detail sections. No `FoodCard`, no `FoodDetailPage`, no Food store.
