# B-17 Portal Design System

Single source of truth for B-17 Portal's visual design. This document describes the **current, implemented** system first, and separately labels anything **PROPOSED** (recommended but not yet approved for implementation) or **FUTURE** (intentionally deferred). It does not invent new hex values, components, or tokens beyond what already exists in the repository unless explicitly marked PROPOSED/FUTURE.

Companion documents: `docs/development/CURRENT_STATE.md` (implementation status), `docs/development/ROADMAP.md` (phase plan), `docs/development/DECISIONS.md` (architecture decisions). This file does not duplicate those — it is the visual-design reference only.

---

## 1. Design Vision

B-17 Portal should feel like a **premium hyperlocal marketplace and community platform** — the first place a B-17 resident checks when they need something nearby, and a place local professionals are proud to list themselves on. The target feeling is modern, trustworthy, warm/local, clean, image-driven, mobile-first, and app-like. It should never feel like a generic admin template, a corporate banking app, a flashy social network, or a cluttered classifieds site.

The product has two visual registers, not one:
- **Consumer surfaces** (Home, Search/Explore, directory, detail pages) — marketplace/discovery-oriented: visual, warm, image-led.
- **Professional surfaces** (the Professional Workspace) — clean, warm, polished workspace/SaaS-oriented: calmer and denser than consumer, but still on-brand, not generic.
- **Admin** — functional and utilitarian: information density over polish, with the existing dark top-bar as its intentional visual signal.

All three share one token system, one type scale, and one motion language — they differ in density and imagery, not in brand.

## 2. Design Principles

- **Trust before decoration.** Every demo/prototype disclosure, honesty label, and status indicator exists to keep trust intact in a system with no real backend yet — never sacrifice this for visual polish.
- **Discovery should feel visual.** Consumer surfaces lead with imagery wherever real content exists.
- **Local warmth, professional polish.** Avoid both cold-corporate and informal-classifieds extremes.
- **Mobile-first.** Every layout decision is verified at ~375px before desktop is treated as "the" layout.
- **Consistency through shared primitives.** New UI composes existing tokens/components (`Typography`, `Container`, `Stack`, `CardImage`) rather than one-off styling; the same applies to the Card primitive once it exists (§8).
- **Clear hierarchy.** One primary action per view; Typography variants, not ad-hoc font sizes, establish hierarchy.
- **Honest states.** Loading, empty, error, and demo states are always distinguished explicitly — never a silent happy-path assumption.
- **Accessibility by default.** Semantic HTML, labeled controls, visible focus states, and color-independent status signaling are a baseline requirement, not a later pass.

## 3. Brand Personality

B-17 Portal **is**:
- **Trustworthy** — honest about what's real (demo data) and what isn't; never fabricates trust signals (ratings, verification) that don't exist.
- **Local** — grounded in B-17 specifically (area names, real-feeling photography, a civic-tech-toned green), not a generic template reskinned for any city.
- **Modern** — current component patterns (shadcn/Radix primitives), clean type, restrained motion.
- **Helpful** — search-first, low-friction, oriented around "find it and contact it," not around engagement/attention mechanics.
- **Premium without luxury excess** — polish through consistency, whitespace, and imagery quality — not through gradients, heavy shadows, or ornamentation.

B-17 Portal is **not**:
- A generic admin template (flat stat tiles everywhere, no personality).
- A corporate banking app (overly formal, cold, distant).
- A flashy social network (decorative animation, attention-maximizing patterns).
- A cluttered classifieds site (dense text walls, no visual hierarchy, no imagery).

## 4. Color System

All colors are defined as CSS custom properties in `src/index.css`, mapped into Tailwind utilities via `@theme inline`. Components must reference tokens (`bg-primary`, `text-muted-foreground`, `shadow-medium`, `z-modal`, etc.) — never hard-coded hex values. Current values, exactly as implemented:

### Light mode (`:root`)
| Token | Value | Usage |
|---|---|---|
| `--primary` | `#047857` | Primary brand color ("location green") — primary buttons, links, active nav states. White on it is **5.48:1** (see "Contrast refinement" below). |
| `--primary-foreground` | `#ffffff` | Text/icons on primary |
| `--brand-accent` | `#c2410c` | "Action orange" — **high-intent/accent use only**: Request, WhatsApp/Contact, Featured ribbon. Not for decoration or general emphasis. White on it is **5.18:1**. |
| `--brand-accent-foreground` | `#ffffff` | Text/icons on brand-accent |
| `--accent` / `--accent-foreground` | `#ecfdf5` / `#065f46` | Internal hover/highlight tint (dropdowns, menu items) — distinct from `brand-accent`; never used as a CTA color |
| `--background` / `--foreground` | `#ffffff` / `#0f172a` | Page background / primary text |
| `--card` / `--card-foreground` | `#ffffff` / `#0f172a` | Card surfaces |
| `--secondary` / `--secondary-foreground` | `#f1f5f9` / `#0f172a` | Secondary surfaces, secondary buttons |
| `--muted` / `--muted-foreground` | `#f1f5f9` / `#475569` | De-emphasized backgrounds/text (captions, helper text, placeholders) |
| `--border` / `--input` | `#e2e8f0` | Borders, input borders |
| `--ring` | `#059669` | Focus ring — intentionally left at the previous primary shade (not changed in the contrast refinement; see Known limitations in `CURRENT_STATE.md` for the focus-indicator review) |
| `--destructive` / `--destructive-foreground` | `#b91c1c` / `#ffffff` | Destructive actions (reject, archive-confirm, delete). Destructive button text on its tinted fill is **5.45:1** (4.59:1 on hover). |
| `--success` / `--success-foreground` | `#16a34a` / `#ffffff` | Approved/success status |
| `--warning` / `--warning-foreground` | `#d97706` / `#ffffff` | Pending/warning status |
| `--info` / `--info-foreground` | `#2563eb` / `#ffffff` | Informational status |
| `--success-text` | `#166534` | Status **text** on a `success/15` tint (status badges). 6.03:1. |
| `--warning-text` | `#92400e` | Status **text** on a `warning/15` tint. 6.05:1. |
| `--info-text` | `#1d4ed8` | Status **text** on an `info/15` tint. 5.45:1. |

### Contrast refinement (Visual V3 gate)
The first light-mode values — primary `#059669`, brand accent `#ea580c`, destructive `#dc2626` — gave white button text only **3.77:1**, **3.56:1** and (destructive text on its tinted fill) **4.14:1**, below the WCAG AA 4.5:1 target for normal-size text. This was a system-wide, pre-existing issue, not specific to any one page. It was fixed at the token level, once:

| Token | Before → after | Scale step | Result |
|---|---|---|---|
| `--primary` | `#059669` → `#047857` | emerald-600 → emerald-700 | white text 3.77 → **5.48:1**; `text-primary` on white 3.77 → 5.48:1 |
| `--brand-accent` | `#ea580c` → `#c2410c` | orange-600 → orange-700 | white text 3.56 → **5.18:1** |
| `--destructive` | `#dc2626` → `#b91c1c` | red-600 → red-700 | button text on tint 4.14 → **5.45:1** (hover 3.52 → 4.59:1) |

Why this is not a palette replacement: each value is the next-darker step of the **same Tailwind color family** the file already draws from (the existing `#065f46`, `#ecfdf5` and `#10b981` are emerald; `#fb923c` is orange), so green is still the main brand color and orange is still the accent. The already-present `#065f46` (7.68:1) was considered and rejected as a larger visual shift than the 4.5:1 target needs. No page-level or one-off overrides were added — every surface that uses these tokens inherits the change (default Buttons, default Badges, the selected filter toggle, `text-primary` labels, the Featured badge/border, destructive buttons).

Orange remains reserved for high-intent/accent use (as implemented today, the Featured badge and featured-card border); it was not made more decorative. **Dark-mode tokens were not changed** (see below). The warning/success/info status colors were not changed in this refinement; their badge-text contrast was fixed separately in Visual V4 (see "Status text tokens" below).

### Status text tokens (Visual V4)
The base `--success`/`--warning`/`--info` colors are fill/icon colors; used as text on their own 15% tint they measured only 2.79 / 2.71 / 4.19:1. Status **text** now uses the dedicated `--success-text`, `--warning-text` and `--info-text` tokens (darker steps of the same families: green-800, amber-800, blue-700), measured as rendered at **6.03 / 6.05 / 5.45:1**. Destructive text on its `/10` tint (5.45:1) and neutral `muted-foreground` on `muted` (6.92:1) already passed. Dark-mode values of the new tokens equal the existing dark status colors. Rule: use `-text` tokens for status text and the base tokens for fills and icons — never page-level hex overrides.

### Dark mode (`.dark`) — tokens exist, not currently user-facing (see §21)
`--primary: #10b981`, `--brand-accent: #fb923c`, `--background: #0b1120`, `--card: #111827`, plus full parallel border/status/sidebar sets. Defined for forward-compatibility; do not design new components assuming dark mode is reachable today. Unchanged by the contrast refinement above.

### Usage rules
- **Green (`primary`) is the default brand color** — navigation active states, primary buttons, links, focus rings, category icon tiles.
- **Orange (`brand-accent`) is reserved for high-intent, user-initiated contact actions** (Request Service, WhatsApp/Contact buttons, Featured badge) — never for general decoration, section headers, or non-CTA emphasis. This restraint is already correctly followed in the current implementation (confirmed via the Visual/UI audit) and must be preserved.
- **Status colors are never the sole signal** — pair with text/icon, not color alone (see §16, §20).

### PROPOSED (not yet approved)
- No new hex values are proposed. The one open item is a deliberate decision on dark mode's rollout (§21) — not a color change.

## 5. Typography

Two self-hosted typefaces (`@fontsource`, no external font CDN): **Poppins** (500/600/700, + latin-ext) for headings/display, **Open Sans** (400/500/600, + latin-ext) for body text. `h1`–`h6` elements get `font-heading` automatically at the base layer; `body`/`html` default to `font-sans`.

All text must compose through `Typography` (`src/components/foundation/Typography.tsx`) — never ad-hoc `text-*`/`font-*` utilities on raw elements. Current variants and their default element mapping:

| Variant | Style | Default element | Usage |
|---|---|---|---|
| `display` | Poppins, 4xl→5xl, semibold, tight tracking | `h1` | Hero headline only |
| `h1` | Poppins, 3xl→4xl, semibold | `h1` | Page title |
| `h2` | Poppins, 2xl→3xl, semibold | `h2` | Section title |
| `h3` | Poppins, xl→2xl, semibold | `h3` | Card/subsection title |
| `body-lg` | Open Sans, lg, relaxed | `p` | Lead paragraph |
| `body` | Open Sans, base, relaxed | `p` | Default body text |
| `body-sm` | Open Sans, sm, relaxed | `p` | Secondary/supporting text |
| `caption` | Open Sans, xs, muted | `span` | Metadata, timestamps, fine print |
| `label` | Open Sans, sm, medium | `label` | Form labels, card titles in dense contexts |

This scale is mature and already consistently applied — **do not replace fonts or restructure the scale** as part of the visual refresh (Locked Decision #2).

## 6. Spacing & Layout

- **Container**: `Container` (`src/components/foundation/Container.tsx`) provides the shared `max-w-7xl` centered wrapper with responsive gutters — all page-level content should sit inside it rather than redefining max-width/padding ad hoc.
- **Stack/Grid**: `Stack` and `Grid` foundation components express vertical/horizontal rhythm and responsive column counts; prefer them over raw flex/grid utility soup in feature code.
- **Section rhythm**: homepage sections follow a consistent pattern — `SectionHeader` (title + description + optional "View all") followed by a card grid or row. This rhythm should extend to any new consumer section rather than inventing a new header pattern.
- **Mobile spacing**: content stacks to a single column below `sm`/`lg` breakpoints; the fixed bottom `MobileNav` reserves space at the bottom of the viewport on mobile (`lg:hidden`).
- **Desktop density**: desktop widens the same components into multi-column grids (confirmed live: Featured Providers renders 4-across at desktop width) rather than switching to a different layout system.

## 7. Radius, Borders & Elevation

Radius scale (`src/index.css`, derived from a single `--radius: 0.625rem` base via `calc()`):

| Token | Formula | Approx. | Usage |
|---|---|---|---|
| `--radius-sm` | `radius * 0.6` | ~0.375rem | Small controls |
| `--radius-md` | `radius * 0.8` | ~0.5rem | Buttons (size-dependent) |
| `--radius-lg` | `radius` | 0.625rem | Default card/surface radius (`rounded-xl` in practice) |
| `--radius-xl` | `radius * 1.4` | ~0.875rem | Larger surfaces |
| `--radius-2xl`–`4xl` | up to `radius * 2.6` | — | Pills, large decorative surfaces (search bar, badges use `rounded-full`/`rounded-4xl`) |

Shadow scale — three steps only, intentionally restrained:
- `--shadow-subtle`: `0 1px 2px 0 rgb(15 23 42 / 0.05)` — default resting card state.
- `--shadow-medium`: `0 4px 12px -2px rgb(15 23 42 / 0.08), 0 2px 4px -2px rgb(15 23 42 / 0.04)` — hover/raised state.
- `--shadow-elevated`: `0 16px 32px -8px rgb(15 23 42 / 0.14), 0 4px 10px -4px rgb(15 23 42 / 0.06)` — dialogs/sheets/popovers, and the search bar's focus-within state.

Z-index scale: `base(0) / sticky(20) / dropdown(30) / modal(40) / toast(50)` — sticky header/bottom-nav, dropdowns, dialogs/sheets, and toasts each claim their own layer; never hard-code a `z-*` value outside this scale.

**When to use which surface treatment:**
- **Flat** (no border, no shadow): page background, section backgrounds (`bg-muted/30`), dense admin list rows.
- **Bordered** (`border border-border`, no/subtle shadow): default resting cards (`shadow-subtle`), empty states, form sections.
- **Elevated** (`shadow-medium`/`shadow-elevated`): hover states, dialogs, sheets, popovers — always tied to a layering or interaction reason, never applied decoratively to a static surface.
- **Interactive** (adds `hover:border-primary/30` + a motion lift, see §18): anything clickable — cards, selectable rows.

Avoid stacking more than one elevation step beyond what the interaction state requires — this system is deliberately restrained; do not introduce heavier shadows or gradient surfaces (see §22).

## 8. Shared Card System — DESIGN SPEC ONLY

> Status note: the `Card` primitive has since been built (Visual V1). The `workspace` variant is consumed by the Resident and Professional surfaces (Visual V4, §12). The text below is the original spec and is kept for rationale.

**Not implemented in this phase.** This section defines the target API for a future `Card` primitive so that Provider/Business/Tutor/Property/News cards can eventually compose it instead of each independently owning identical surface styling.

### Current state (the problem this solves)
`ProviderCard` and `BusinessCard` (and, by the same pattern, `TutorCard`, `PropertyCard`, `NewsCard`, `FeaturedCard`, `CategoryCard`, `ListingSummaryCard`) each hand-roll the identical wrapper class string:
```
flex cursor-pointer flex-col gap-3 rounded-xl border border-border bg-card p-3
text-left shadow-subtle transition-colors hover:border-primary/30
focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50
```
combined independently with `motion`'s `cardHover` preset in each component. One shared primitive would let every future surface/hover/radius refinement happen in one place.

### Proposed variants
| Variant | Surface | Border | Shadow | Hover |
|---|---|---|---|---|
| `default` | `bg-card` | `border-border` | `shadow-subtle` | none (static informational card) |
| `interactive` | `bg-card` | `border-border` → `hover:border-primary/30` | `shadow-subtle` → `shadow-medium` on hover | `cardHover` motion lift (today's Provider/Business card behavior) |
| `elevated` | `bg-card` | `border-border` | `shadow-medium` at rest | subtle lift only |
| `workspace` | `bg-card` | `border-border` | `shadow-subtle` | none — denser padding, no lift (Professional Workspace stat tiles, listing rows) |
| `featured` | `bg-card` | `border-brand-accent/40` or dashed (matches current `FeaturedCard` treatment) | `shadow-subtle` | same as `interactive` |

### Proposed API shape
- `radius`: fixed at `rounded-xl` (`--radius-lg`) for all variants — consistency over per-card customization.
- `padding`: `p-3` default (matches all current cards); `workspace` variant may use tighter `p-4`/`p-3` row padding where density matters more than breathing room.
- **Imagery integration**: a `Card` should accept an optional `image` region (composing `CardImage`/`PlaceholderImage` directly, §9) rendered above the content, always `aspect-video w-full rounded-lg object-cover` — the primitive should not reimplement image handling, only reserve the slot.
- **Clickable behavior**: `interactive`/`featured` variants render as `role="button"`/`tabIndex={0}` with `onClick`/`onKeyDown` (Enter/Space) exactly as today's cards do by hand — this keyboard-activation behavior must be preserved, not dropped, when centralizing.
- **Accessibility**: every interactive card variant requires an explicit `aria-label` (today: `` `Preview ${name}` ``) — the primitive should make this a required prop, not optional, so a future card can't silently ship without one.

### Migration path
Existing domain cards (`ProviderCard`, `BusinessCard`, `TutorCard`, `PropertyCard`, `NewsCard`) would each shrink to: a `Card` wrapper (variant `interactive` or `featured`) + their own content (title, category, tags, CTA row) — the surface styling (border/radius/shadow/hover/focus-ring/keyboard handling) moves into the primitive once, instead of being re-declared five-plus times. This is explicitly **Visual Phase V1** (§23) — not part of this document's scope to build.

## 9. Imagery System

Imagery is the single highest-leverage lever identified in the Visual/UI audit — see root-cause analysis there. Current seam: **every card renders images through `CardImage`**, which falls back to `PlaceholderImage` when `src` is absent or fails to load (`onError`). This seam is correct and should be preserved and extended, not replaced.

### Aspect ratio & crop
- **Card imagery**: `aspect-video` (16:9), `object-cover`, `rounded-lg` — uniform across every domain card today. Preserve this ratio for the Card primitive's image slot (§8).
- **Detail-page hero imagery**: currently a larger single `aspect-video`-derived hero image per detail page (confirmed live on a Business detail page) — a PROPOSED richer detail-page treatment is in §11.
- **Homepage hero**: full-bleed background photo, not card-constrained — this is the one intentionally different ratio/treatment in the app and should stay that way (it's the "premium" visual anchor).

### Placeholder behavior
- `PlaceholderImage` renders a centered Lucide icon at 70% opacity (`opacity-70`) on a tinted background (`bg-accent`/`tone="accent"` → `bg-secondary`), `aspect-video`, with `role="img"` and an `aria-label` of `Demo image placeholder for {label}` — already accessible, keep this pattern.
- **A placeholder is acceptable** for session-submitted demo listings (no photo was ever supplied) and for any domain where client photography genuinely doesn't exist yet.
- **A placeholder is not ideal on a `Featured` item** — the Visual/UI audit found Featured Business cards (e.g., "Capital Cuts Salon") rendering generic icon placeholders, which undercuts the credibility the "Featured" label is meant to convey. PROPOSED: Featured placement should prefer listings with real imagery once more photography exists, or the Featured treatment itself should visually compensate (stronger badge/border) when no photo is available — a content/product decision, not a code change, for this phase.

### Resilience requirements (must hold regardless of future content)
- Layout must not break with: a missing image (→ placeholder, already handled), an unusually tall/wide source image (→ `object-cover` crop, already handled), a low-quality/small source image (→ still fills the `aspect-video` box via `object-cover`, no stretching), or a long title/description (→ `line-clamp-2` already used on card descriptions; verify any new imagery-adjacent text follows the same pattern).
- All current demo imagery is placeholder/demo content and will be replaced by real client-supplied photography later — do not hard-code assumptions about specific demo filenames into new components; always go through `CardImage`'s `src?` + fallback contract.

### Imagery by surface (current + intended)
| Surface | Current treatment | Notes |
|---|---|---|
| Hero | Full-bleed background photo | Only full-bleed moment in the app — preserve as the "premium" anchor |
| Provider cards | Real photo (good coverage) | — |
| Business cards | Mixed — some real, many placeholder | Coverage gap, see above |
| Tutor cards | Placeholder (no tutor photography exists) | Acceptable for now — avatars could be a lighter-weight future treatment than full `aspect-video` photos |
| Property cards | Real photo | — |
| News cards | Real photo | — |
| Ads/sponsored | Placeholder/example copy, explicitly labeled "Coming in a future release" | Correct — do not fabricate real sponsor imagery |
| Avatars (resident/professional profile) | Generic circular icon (`User` icon in a colored circle), no photo upload exists | Acceptable for a no-backend prototype; a future avatar-upload feature is out of this document's scope |
| Placeholders | Icon + tint, `aspect-video`, accessible `aria-label` | Keep as the universal fallback contract |

## 10. Consumer Marketplace Components

Current treatment, to be preserved/extended during the refresh (no component rewrites in this document — these are the target visual qualities for Visual Phase V2+):

- **Header**: sticky, translucent-blur background (`bg-background/95 backdrop-blur`), brand mark + desktop nav + search/List-Your-Business/Login — keep as the consistent top anchor across all consumer pages.
- **Hero**: full-bleed photo, search-first, "Try:" quick chips — the strongest existing moment; extend its visual confidence (large type, generous whitespace) as the model for what "premium" should feel like elsewhere, without literally repeating a full-bleed hero on every page.
- **Global search** (`SearchBar`): pill-shaped, `shadow-subtle` → `shadow-elevated` on focus-within, two sizes (`hero`/`compact`) sharing one component — correct pattern, reuse for any new search-adjacent surface.
- **Filter controls / active filter chips**: currently plain `<select>`-style dropdowns and pill badges on the Search/Explore page — functionally correct but visually generic; PROPOSED for Visual Phase V2 to gain more visual weight (closer to the search bar's polish) without becoming decorative.
- **Category cards**: icon-tile pattern (colored rounded-square icon + label) — appropriate for taxonomy browsing; keep icon-forward, not photo-forward, since categories aren't individual listings.
- **Provider/Business/Tutor/Property/News cards**: see §8 for the target shared primitive; visual qualities to preserve regardless of implementation — image-top, `DemoBadge` always visible, category in primary color, muted description (`line-clamp-2`), area with map-pin icon, two-button CTA row.
- **Detail pages**: see §11.
- **CTAs**: primary (green) for navigational/default actions, brand-accent (orange) specifically for Request/WhatsApp/Contact — preserve this split exactly.
- **EmptyState**: centered icon-in-circle + title + description + optional action — already consistent across Listings/Saved/Requests/Search-no-results; reuse verbatim for any new empty state rather than inventing a new layout.
- **Save/Favorite**: heart-icon toggle overlaid top-right on card imagery (`SaveButton`) — keep the overlay-on-image position consistent across all card types that support saving.

## 11. Detail Page Pattern

Current state (confirmed live on a Business detail page): large hero image → name/category/description/tags → CTA row → done. Functionally honest, visually thin once past the photo.

**PROPOSED** richer, reusable detail-page composition (Visual Phase V3, not built in this document):
1. **Cover region** — current large hero image, unchanged ratio.
2. **Identity + trust region** — name, category badge, `DemoBadge`, area — visually grouped more deliberately than today's flat stack (e.g., a title block with clearer vertical rhythm), without inventing trust signals that don't exist (no star ratings, no verification badges beyond what's real today).
3. **Primary CTA** — unchanged (WhatsApp/Request or Contact), kept visually prominent, ideally sticky-positioned on mobile scroll (PROPOSED, not committed).
4. **Supporting information sections** — description, tags/services, area — given clearer section separation (e.g., `Divider` + `SectionHeader`-style labels) instead of one undifferentiated text block.
5. **Related/supporting content** — e.g., "More in this category," reusing existing card components — only if the underlying data/search seam already supports the query cheaply; this is a nice-to-have for a later visual phase, not a requirement.

Do not add ratings, maps, or review features — none exist in the product today and none are approved by this document.

## 12. Professional Workspace

The workspace already achieves a distinct, correctly-scoped shell: its own header ("B-17 Portal · Provider"), its own tab nav (`ProfessionalNav`: Overview/Listings/Leads/Analytics/Profile), entirely separate from the consumer `Header`/`MobileNav`.

- **Workspace nav**: tab-underline pattern (`border-b-2 border-primary` on active) — keep this pattern; it already reads as "workspace," not "marketplace."
- **Metric cards** (Overview stat tiles): currently flat numeric tiles with no imagery — correct for a dashboard; the warmth the brief asks for should come from typography/spacing polish (generous padding, clear numeral hierarchy) rather than photography, which doesn't belong on a stats dashboard.
- **Listings**: `ListingSummaryCard` + inline action rows (View/Edit/Archive) — reuses the same card-surface pattern as consumer cards (§8), appropriately denser.
- **Leads**: list-based, status-driven — should follow the same `workspace`-variant card treatment once the Card primitive exists.
- **Profile**: minimal settings form — follow Forms & Inputs (§14) exactly.
- **Analytics (locked state)**: lock icon + explanation + "See Premium" CTA — already a good, non-decorative upsell pattern; preserve it as the model for any future locked-feature UI.
- **Premium/locked states generally**: never hide a gated feature entirely — show it locked with a clear unlock path (current Analytics tab behavior), consistent with the product's capability-model philosophy.

### Shared workspace pattern (Visual V4)
Resident account pages and Professional Workspace pages use one small set of shared building blocks rather than page-specific styling:

- **`Card` `workspace` variant** — the surface for metric tiles, list rows, quota/plan cards and inline empty states (a dashed, shadowless variant of it for empty/upsell strips).
- **`WorkspaceTabs`** — the single underline-tab row for both the Resident (Overview/Saved/My Requests) and Professional (Overview/Listings/Leads/Analytics/Profile) navs: 44px tall, fits at 375px, active tab marked by underline + weight (not color alone).
- **`MetricTile`** — compact count tile showing a real derived number; optionally a whole-tile link.
- **`WorkspaceSection` / `WorkspaceEmpty`** — a titled region (h2 + optional "View all") and its inline empty state, which always offers a real next action.
- **`SelectableCard`** — a workspace list row that opens a detail view or navigates, built on a native button/link inside the card.
- **`RequestProgress` / `RequestMeta`** — status-derived progress for a service request (a decorative bar on list rows, a labeled step tracker in detail) and its submitted/preferred/area line. Progress shows position only; it never implies timestamps, ETAs or history.
- **`StatusBadge`** — see §16.

Focus on these surfaces uses a solid `ring-ring` (3.77:1 on white) rather than the 50%-alpha default.

The workspace should read as "warmer SaaS tool" relative to Admin: same tokens, same `Card` surfaces once built, but more breathing room and typography confidence than Admin's dense rows — not more imagery.

## 13. Admin

Preserve exactly:
- **Dark top-bar** (`bg-foreground text-background`, `#0f172a`-on-white-text in practice) — the one deliberate visual differentiator signaling "internal tool," confirmed live and explicitly called out as a keep in the Visual/UI audit.
- **Compact nav row** (not a sidebar) — Dashboard/Listings/News & Updates, icon + label, matches the existing information-density-first intent.

Define going forward:
- **Direction (Visual V5)**: Admin is operational, dense and utilitarian — it prioritizes scanability over decoration, and stays clearly distinct from the consumer marketplace and the warmer Resident/Professional workspaces. It reuses the shared tokens, `Card` surface and `StatusBadge`, with tighter padding than the workspace.
- **Moderation rows**: a compact list row (identity: title, type/category, submitter and date; then status badge and action) is correct for density — keep rows, do not convert to a card grid. On mobile the status and actions stack beneath the identity. The primary action (Review) is filled only where action is needed (pending items).
- **Tables/lists**: favor consistent row height and left-aligned text over decorative styling; status is always the shared `StatusBadge`, never color-only (see §16/§20).
- **Status visibility**: pending/approved/rejected/archived and draft/published use the shared `StatusBadge` (tone + icon + label, accessible text contrast); do not map unrelated statuses onto a tone merely to reuse it.
- **Review surfaces**: lead with the facts a moderation decision needs (identity, type, submitter, date, current status, any rejection reason); keep the decision actions always reachable (sticky on small screens).
- **Forms**: Admin content forms (news create/edit) follow the same Forms & Inputs rules as everywhere else (§14) — Admin density comes from layout/spacing, not from different form components.
- **Actions**: primary action (Review/Approve) uses `default`/`outline` button variants exactly as elsewhere; destructive actions (Reject) use the `destructive` button variant — no Admin-specific button styling. Important actions are ≥44px on touch and compact from `sm`.
- **Focus**: Admin controls use a strong solid focus ring with a contrasting gap (and a solid white ring on the dark header). This is Admin-local; the global shared focus-ring token (§20) is unchanged and its cleanup remains future work.

**Imagery in Admin is functional, not decorative**: a compact thumbnail appears in a row only when the record actually has media (with the shared fallback if it fails to load); otherwise a small kind icon is used. Never invent a media slot for text-only items, and never let imagery dominate a dense row.

## 14. Forms & Inputs

Current shadcn-pattern primitives (`Input`, `Label`, `Textarea`, `Toggle`/`ToggleGroup`) already establish the base style — this section documents usage rules, not new components:

- **Labels**: always a `Label`/`Typography variant="label"` above its control, never placeholder-as-label.
- **Field spacing**: `Stack gap={}` vertical rhythm between fields (consistent with foundation components elsewhere) — no ad-hoc margin stacking.
- **Focus state**: `focus-visible:ring-3 focus-visible:ring-ring/50` + `border-ring` — already applied consistently via shared `Input`/`Button` variants; any new input must inherit this, not redefine focus styling.
- **Errors**: `aria-invalid` triggers `border-destructive` + `ring-destructive/20` automatically on shared inputs/buttons (already wired in the component variants) — pair with visible error text, never color alone.
- **Helper text**: `Typography variant="caption"` (muted) directly below the field.
- **Sheets/dialog forms**: use the existing `Dialog`/`Sheet` primitives (Radix-based) — `shadow-elevated`, `z-modal` — never a custom modal implementation.
- **Mobile behavior**: forms stack to single-column full-width fields below `sm`; `Sheet` (bottom-sheet pattern) is preferred over `Dialog` for mobile-triggered forms where the existing codebase already makes that choice (verify per-component, don't assume).

## 15. Buttons & CTAs

`Button` (`src/components/ui/button.tsx`) variants and their meaning — do not introduce new variants outside this set without updating this document:

| Variant | Visual | Usage |
|---|---|---|
| `default` (primary) | `bg-primary` solid; hover mixes 12% of `--foreground` into primary (`color-mix(in srgb, …)`, a darker brand-compatible green, **6.42:1** with white text — the former `primary/80` hover lightened the fill and fell to 2.86:1) | Default action, navigation CTAs |
| `secondary` | `bg-secondary` solid | Secondary emphasis, lower priority than primary |
| `outline` | bordered, transparent fill | Tertiary actions, "View"/"Edit"-style row actions, WhatsApp button |
| `ghost` | no border/fill until hover | Icon buttons, low-emphasis actions (search icon in header) |
| `destructive` | `bg-destructive/10` tinted, not solid red | Reject/archive-confirm — intentionally restrained, not alarm-red |
| `link` | text-only, underline on hover | Inline text actions |

**High-intent orange CTA**: not a `Button` variant — it would be applied via explicit `bg-brand-accent` classes on top of the `default` button structure, reserved specifically for Request/Contact/WhatsApp-style actions per §4. *Current implementation note:* the Request/Contact/WhatsApp buttons (cards and detail pages) use the primary green `default` variant, and orange appears only on the Featured badge and featured-card border; with the contrast refinement (§4) white text on orange is 5.18:1, so an orange button is now permissible if a future phase chooses it. Do not apply orange to navigational buttons, section CTAs ("View all"), or any non-contact action — "View all" links correctly use plain primary-colored text links today, not buttons, and should stay that way.

Sizes (`xs/sm/default/lg/icon*`) follow a fixed height/radius scale already defined in `buttonVariants` — reuse, don't redefine per-feature.

## 16. Badges & Status

`Badge` (`src/components/ui/badge.tsx`) variants: `default` (primary-filled), `secondary` (muted — used by `DemoBadge`), `destructive`, `outline`, `ghost`, `link`.

- **Status badges** (pending/approved/rejected/archived, request statuses, and Free/Premium plan): always paired with text, never a bare color dot.
- **Shared `StatusBadge` pattern** (`src/components/feedback/StatusBadge.tsx`, Visual V4): every status is a semantic **tone** (`success`/`warning`/`info`/`danger`/`neutral`) + a semantic **icon** + a **text label**, with text colored by the `-text` status tokens (§4) so contrast stays ≥4.5:1. Domain wrappers (`ListingStatusBadge`, `RequestStatusBadge`) only map their status to tone/icon/label, so Resident and Professional show the same language for a request. Statuses that share a tone must differ by icon and label (e.g. Accepted vs Completed). Prefer this pattern for any new status; Admin and a few consumer badges still use the older presentation (§23, V5).
- **Free/Premium badges**: `Free Plan`/`Premium Plan` shown as plain outlined/secondary badges near plan-relevant UI (confirmed live on Workspace Overview) — keep understated; this is informational, not a decorative achievement badge.
- **Category tags**: `outline` or `secondary` badge variant, small, used in multiples (detail page "Details" tag row) — fine as-is.
- **Verified/future trust badges**: none exist today and none are approved for this document — do not design or imply a verification badge system without an explicit product decision; `DemoBadge` exists specifically to prevent this ambiguity ("Demo Listing" is always visible, never a real trust claim).
- **Never rely on color alone**: every status/plan badge carries a text label today — preserve this; an icon-only or color-only badge is a regression.

## 17. Navigation

| Surface | Component | Pattern |
|---|---|---|
| Consumer desktop | `Header` + `DesktopNav` | Sticky, blurred background, horizontal links, right-aligned search/List-Your-Business/Login |
| Consumer mobile | `MobileNav` | Fixed bottom tab bar, max 5 destinations, icon + 11px label, active = primary color |
| Resident account | `/profile` tabs (Overview/Saved/My Requests) | `WorkspaceTabs` in-page tab row, not a separate shell — resident stays inside the consumer Header |
| Professional | `ProfessionalNav` inside its own workspace shell | `WorkspaceTabs` underline-tab pattern, separate header ("· Provider") from consumer Header |
| Admin | Compact nav row inside `AdminLayout` | Icon + label on a dark bar, separate header ("· Admin") from consumer Header |

Three shells (consumer / professional / admin) are intentional and must stay visually distinct at the header level (already correct) while sharing the same underlying token/type/motion system (also already correct) — do not merge them into one shell, and do not let Admin/Professional's headers drift onto the consumer `Header` component.

## 18. Motion & Microinteractions

Centralized in `src/lib/motion.ts` (seconds-based, for the `motion` library) — do not introduce ad-hoc durations/easings outside this file.

| Token | Value | Usage |
|---|---|---|
| `duration.press` | 0.1s | Button press |
| `duration.hover` | 0.16s | Card hover lift |
| `duration.dropdown` | 0.18s | Dropdown open |
| `duration.modal` | 0.24s | Dialog/sheet open |
| `duration.toast` | 0.22s | Toast enter |
| `duration.route` | 0.28s | Section/fade-up reveal |
| `duration.detail` | 0.35s | Larger detail-level transitions |
| `stagger.item` | 0.05s | Per-item delay in staggered grids |

Presets: `fadeUp` (section reveal), `cardHover` (±2px lift + 1.01 scale on hover, 0.99 on tap), `staggerContainer`/`staggerItem` (card grid entrance). Appropriate use:
- **Card hover**: `cardHover` preset only — no additional decorative hover effects (no rotation, no color-shifting borders beyond the existing `hover:border-primary/30`).
- **Button press**: built into `Button`'s own `active:translate-y-px` — no separate motion wrapper needed.
- **Save/favorite**: a lightweight icon-fill transition is acceptable (not yet audited in detail — if `SaveButton` lacks one, this is a PROPOSED small addition, not a requirement).
- **Dialog/sheet**: Radix's own enter/exit, timed to `duration.modal` — do not override with a custom spring.
- **Section reveal**: `fadeUp`/`staggerContainer` on first scroll into view — already used on homepage sections; extend to any new section, don't invent a different entrance.
- **Status change**: a plain state swap (e.g., badge text/color change) is sufficient — do not animate status transitions beyond the existing color/label change.

**No decorative over-animation** — every current motion use ties to a real state change (hover, entrance, open/close). `@media (prefers-reduced-motion: reduce)` is already respected globally (`src/index.css`) — any new motion must remain inside that guard automatically by using the shared tokens/presets rather than a raw `motion.div` with custom values.

## 19. Responsive Design

Verified breakpoints and expectations (confirmed live during the Visual/UI audit):

- **~375px (mobile)**: single-column stacking; `MobileNav` fixed bottom bar is the primary navigation (replaces `DesktopNav`); hero remains full-bleed but consumes a large first-screen share — acceptable today, a PROPOSED trim is noted in the audit as P3 (low priority); search bar is the first interactive element below the fold-safe hero text. No horizontal overflow observed on Home, Business detail, Professional Workspace, Admin, or Resident Profile during the audit.
- **~820px (tablet)**: card grids typically move from 1 to 2 columns; `DesktopNav` is not yet shown (`lg:flex`/`lg:hidden` breakpoints gate at `lg`, i.e. 1024px in this Tailwind config) — tablet still sees the mobile header/bottom-nav pattern unless explicitly verified otherwise per page.
- **~1440px (desktop)**: full multi-column grids (confirmed 4-across on Featured Providers), `DesktopNav` visible, `Container`'s `max-w-7xl` caps content width with growing side gutters beyond that.

**Mobile-first rules:**
- **Touch targets**: nav items use `min-h-11` (44px) — maintain this minimum for any new tappable element.
- **Content priority**: search and primary CTAs stay above/near the fold; secondary navigation (category browsing) follows.
- **Search prominence**: the hero search bar and the compact `Search/Explore` bar share one `SearchBar` component specifically so prominence/behavior stay consistent across contexts.
- **Card stacking**: single column on mobile, no horizontal scroll-snap carousels in the current implementation — grids simply wrap/stack; do not introduce horizontal-scroll card rails without a specific justification, since none exist today.
- **Dashboard adaptation**: Professional Workspace stat tiles wrap from a multi-column grid to stacked/2-column on narrow widths — verify at 375px whenever this grid changes.

## 20. Accessibility

Visual-design requirements, confirmed present today and required to remain so:

- **Contrast**: current palette's text colors (`foreground #0f172a` on `background #ffffff`, `muted-foreground #475569` on `muted #f1f5f9`) read as comfortably AA-compliant for body text; any new color pairing introduced in future phases should be checked against WCAG AA before use (no automated contrast audit was run as part of this document — that's Phase 9J scope).
- **Focus visibility**: every interactive primitive (`Button`, `Badge`-as-link, card wrappers, nav links) carries an explicit `focus-visible:ring-3 focus-visible:ring-ring/50` treatment — never remove focus outlines without an equivalent visible replacement.
- **Text sizing**: all text sizing goes through `Typography` variants (§5) — never a raw `text-[Npx]` value that bypasses the scale.
- **Touch targets**: 44px (`min-h-11`) minimum on primary navigation; apply the same minimum to any new mobile-tappable control.
- **Semantic status**: status is always text + color together (§16, §20) — color is reinforcement, never the sole channel.
- **Color independence**: do not add any indicator (success/error/plan tier/moderation status) that relies on hue alone to be understood.
- **Readable overlays**: overlay elements on imagery (`SaveButton` heart icon, `Featured` badge) sit on a solid/semi-opaque chip background (confirmed: white circular backing on `SaveButton`) rather than directly on photo pixels — preserve this pattern for any new image-overlay element.

## 21. Dark Mode

- Dark-mode CSS custom properties **exist in full** (`.dark` block, `src/index.css`) — primary `#10b981`, brand-accent `#fb923c`, background `#0b1120`, etc.
- **No user-facing dark mode is implemented** — there is no theme toggle, no `prefers-color-scheme` wiring, and no `.dark` class application anywhere in the current UI.
- **This visual refresh does not include dark mode.** Do not build a toggle or wire `prefers-color-scheme` as part of any Visual Phase (§23) unless explicitly re-scoped.
- **Reserved for a future, separate decision** — either commit to shipping it (and audit every component against the dark token set) or formally deprioritize/remove the dark tokens. Leaving them permanently unused and unaudited is a small but real tech-debt risk (noted in the Visual/UI audit, P2).

## 22. Design Anti-Patterns

Explicitly prohibited:
- Random/one-off hex values outside the token file (`src/index.css`).
- Arbitrary radii outside the defined scale (`--radius-sm` through `--radius-4xl`).
- Page-specific card styling that duplicates the shared card class pattern (§8) without a documented reason — once the `Card` primitive exists, new domain cards must compose it, not re-derive the wrapper classes.
- Gradients beyond what already exists (none currently used on surfaces — the hero photo's natural tones are not a CSS gradient) — do not introduce decorative gradient fills.
- Shadows beyond the three-step scale (§7) — no custom drop-shadow values.
- Animation added purely for decoration (no state change it's communicating).
- Oversized/empty dashboard cards — stat tiles should size to content, not stretch to fill space with large empty padding (watch for this specifically if Professional Workspace metric cards are revisited).
- Fabricated ratings/reviews/verification badges — none exist in the product; do not design or imply them without an explicit, separate product decision (see §16).
- Inconsistent placeholder treatments — always route through `CardImage`/`PlaceholderImage` (§9); never a bespoke "no image" state per component.
- Low-contrast text — never style text below the established `muted-foreground`/`foreground` contrast levels for its context.
- Arbitrary new fonts — Poppins/Open Sans only (§5); no per-feature font substitution.

## 23. Migration Strategy

Proposed small, independently verifiable implementation phases for the visual refresh. None are started by this document — this is planning only.

### Visual Phase V1 — Shared Card Primitive + Surface Foundation
- **Objective**: build the `Card` primitive specified in §8 and migrate existing domain cards to compose it.
- **Scope**: new `Card.tsx` (variants: default/interactive/elevated/workspace/featured per §8); migrate `ProviderCard`, `BusinessCard`, `TutorCard`, `PropertyCard`, `NewsCard`, `FeaturedCard`, `CategoryCard`, `ListingSummaryCard` to use it; no visual behavior change beyond centralizing identical styling (should be a near-zero visual diff, verified via screenshots before/after).
- **Out of scope**: any new card variant beyond what domain cards already need; imagery coverage changes (that's V2/V3).
- **Verification**: build/lint/tsc clean; live visual diff of every migrated card at 375/820/1440px shows no unintended change; keyboard activation (Enter/Space) and `aria-label` preserved on every migrated card.

### Visual Phase V2 — Consumer Discovery/Card Refresh
- **Objective**: raise the visual confidence of Search/Explore filters and category/directory browsing surfaces (§10).
- **Scope**: filter bar and active-filter-chip visual treatment; Directory landing page density fix (currently reads as unfinished with only 2 category tiles and a large empty area).
- **Out of scope**: new filter logic/behavior — visual treatment only, per `.claude/rules/frontend.md`'s scope-creep guidance.
- **Verification**: no change to filter/search behavior or URL state; responsive re-check at 375/820/1440px.

### Visual Phase V3 — Detail Pages + Imagery
- **Objective**: implement the richer detail-page composition (§11) and close the Business Directory imagery-coverage gap (§9) to the extent real/better placeholder assets allow.
- **Scope**: detail-page section restructuring (cover/identity/CTA/supporting-info regions); placeholder-vs-photo policy for Featured items.
- **Out of scope**: ratings, maps, reviews, or any feature not already in the product.
- **Verification**: every existing detail-page route still renders all current data fields; no broken layout with missing images/long text (§9 resilience requirements).

### Visual Phase V4 — Resident + Professional Workspace Polish
- **Objective**: apply the `Card` primitive (`workspace` variant) and typography/spacing polish to Resident Profile and Professional Workspace surfaces (§12).
- **Scope**: Overview stat tiles, Listings/Leads rows, Profile/Settings forms.
- **Out of scope**: new workspace features/modules (that's product-roadmap scope, not visual refresh).
- **Verification**: no change to capability-gating behavior (Analytics lock, listing limits) — visual only.

### Visual Phase V5 — Admin Refinement
- **Objective**: apply any shared-primitive consistency gains to Admin moderation rows/forms while strictly preserving the dark-bar/density identity (§13).
- **Scope**: moderation row visual consistency, form field consistency with §14.
- **Out of scope**: adding imagery to Admin; changing moderation logic.
- **Verification**: moderation approve/reject/status flows behave identically; dark header preserved.

### Visual Phase V6 — Final Responsive, Accessibility & Interaction Polish
- **Objective**: close the remaining accessibility and responsive debt across all surfaces (global focus visibility, `EmptyState` heading semantics, undersized consumer targets, Admin logout) and close remaining §19 responsive gaps (mobile hero sizing, any tablet-specific issues found during V1–V5) and verify motion consistency across all migrated surfaces.
- **Scope**: targeted responsive fixes identified during earlier phases; final motion-token audit (no new tokens expected).
- **Out of scope**: new animation concepts not already defined in `src/lib/motion.ts`.
- **Verification**: full 375/820/1440px pass across consumer/professional/admin; `prefers-reduced-motion` still respected.

Each phase should land as its own commit/review cycle, per the existing one-phase-per-commit workflow (`.claude/rules/git.md`) — this document does not authorize starting any of them.

---

*This document reflects the implemented system as of Phase 9E (commit `d3fa12f`) plus the approved Visual/UI Refresh audit findings. Update it whenever a Visual Phase (§23) changes an actual token, component, or pattern — it must remain the single visual-design source of truth; do not create parallel UI.md/UX.md/THEME.md/COLORS.md files.*
