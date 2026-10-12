# Search UX Findings (Phase 9M)

Exploratory review of Search / Explore using the Playwright MCP browser, desktop (1280×800) and mobile (375×812), against the production build served at `http://127.0.0.1:4173`, plus the behavior pinned by the E2E suite (`e2e/search.spec.ts`, `e2e/mobile/mobile.spec.ts`). Search semantics, ranking and layout were **not** changed in Phase 9M; only the one functional/accessibility blocker (F1) was fixed.

Severity scale: **BLOCKER** (functional / accessibility failure) · **HIGH** · **MEDIUM** · **LOW** · **NOT AN ISSUE**.

## Summary

| # | Finding | Severity | Status |
|---|---|---|---|
| F1 | Result cards exposed a Save button nested inside the "Preview" button | BLOCKER (a11y) | **Fixed in 9M**, regression-tested |
| F2 | Save button is 32×32 px on Search cards (below the 44 px touch guideline) | LOW | Open, deferred |
| F3 | The suggestion list overlays the filter row until dismissed | LOW | Open, deferred |
| F4 | Typing is debounced 250 ms into the URL, so a result list briefly lags the input | NOT AN ISSUE | — |
| F5 | URL is the single source of truth (reload, Back/Forward, direct URL all restore state) | NOT AN ISSUE | Pinned by E2E |
| F6 | Food vs General scope and Food-only filters reset correctly; unknown URL values ignored | NOT AN ISSUE | Pinned by E2E |
| F7 | Zero-result state names the query and scope and offers real next steps | NOT AN ISSUE | Pinned by E2E |
| F8 | Keyboard operation of the suggestion combobox (ArrowDown / Enter / Escape) | NOT AN ISSUE | Pinned by E2E |

## F1 — Nested interactive controls in result cards — BLOCKER (fixed)

- **Reproduction:** open `/search?q=pharmacy`, inspect the accessibility tree. The card was `button "Preview B-17 Family Pharmacy"` (a `role="button"` card container) and it **contained** `button "Save B-17 Family Pharmacy"` plus the card's own action buttons.
- **Expected:** one named preview control and independent Save / WhatsApp / Contact controls, none nested in another interactive element (WCAG 4.1.2; ARIA disallows interactive descendants of a button).
- **Actual:** nested interactive controls — screen readers announce the Save/WhatsApp controls unreliably, and a clickable container with `tabindex` plus inner buttons gives confusing keyboard and pointer behavior.
- **Fix:** the card container is now a non-interactive surface; a single stretched, named overlay button (`CardPreviewTrigger`, "Preview <name>") sits behind the independent Save / action buttons, which sit above it with their own hit targets. Applied to `BusinessCard`, `ProviderCard`, `TutorCard`, `PropertyCard`. Visual appearance, Search semantics and what opens the preview are unchanged; Framer Motion's injected `tabindex="0"` on the card is countered with `tabIndex={-1}`.
- **Verification:** RED test first (`src/components/cards/cards.a11y.test.tsx`, a nested-interactive detector over all four card types, in preview and non-preview modes), then GREEN; Tab order is Preview → Save → action buttons; Enter / Space / click on the preview control still open the preview, Save still toggles without opening it. Browser regression in `e2e/search.spec.ts` ("a card exposes one preview control…"). Visually re-checked at 1280 px and 375 px — no visible change.

## F2 — Save button touch target on Search cards — LOW (open)

- **Reproduction:** `/search?q=pharmacy`, measure the heart button: 32×32 CSS px. (The Saved page already enlarges it to 44 px.)
- **Expected:** ≥ 44×44 px touch target on phones (project guideline); WCAG 2.2 AA minimum is 24 px, which it meets.
- **Actual:** 32×32 px, positioned over the card image.
- **Recommendation:** add an invisible hit-area extension (`after:` pseudo-element, as already used for filter chips) in a visual/polish phase. Not changed in 9M: layout/visual change, not a functional or accessibility blocker.

## F3 — Suggestion list overlays the filter row — LOW (open)

- **Reproduction:** on `/search`, type a query; the suggestion listbox opens under the input and covers the content-type radios until it is dismissed (Escape, outside click, or picking an option).
- **Expected / actual:** standard combobox behavior; the list is dismissible by keyboard and pointer, and picking a suggestion commits it. The only friction is that the covered filters are not clickable until it closes.
- **Recommendation:** none required; optionally close the list on filter focus. The E2E suite dismisses it explicitly before changing type.

## NOT AN ISSUE (verified, pinned by tests)

- **F4 (debounce):** typing commits to the URL after 250 ms; Enter and picking a suggestion commit immediately; a pending commit is cancelled by Back/Forward.
- **F5 (URL as source of truth):** reload, Back/Forward and direct URLs restore query, type, filters and sort; "Clear" resets all of them together.
- **F6 (Food vs General):** the Business Type filter scopes results; Food adds Food Category and Service filters; switching back drops them in the same URL write; unknown `foodCategory` / `service` values are ignored rather than trusted.
- **F7 (empty state):** names what was searched and where, and offers "Clear search…" and "Search all of B-17".
- **F8 (combobox):** `aria-expanded`, `aria-activedescendant`, ArrowDown/Up wrap, Enter selects the highlighted option, Escape closes without selecting and keeps the text.

## Out of scope for 9M (not changed)

Ranking, suggestion content, filter set, result card layout/visuals, personalization, recent searches, sharing, and any backend-driven search. Search UX *refinement* (as opposed to the accessibility blocker above) remains a separate, optional phase.
