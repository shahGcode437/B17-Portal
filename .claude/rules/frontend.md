# Frontend Rules

- Follow the existing React + TypeScript + Vite architecture — do not introduce a new framework, meta-framework, or build tool without explicit approval.
- TypeScript strict mode must remain green. Never disable it or silence errors to make a change pass.
- Avoid `any`. If it is truly unavoidable, add it narrowly and explain why in a comment.
- Design mobile-first: verify 375px before assuming desktop layout is "the" layout.
- Preserve accessibility: semantic HTML, correct heading hierarchy, labeled form controls, keyboard operability, visible focus states.
- Reuse the existing design system (`Container`/`Stack`/`Grid`/`Typography`/`Button`/`Badge`/`CardImage`/`EmptyState`/etc.) instead of writing new ad-hoc UI for something it already covers.
- Preserve feature boundaries (`src/features/<domain>/`) — don't reach across domains or flatten them into a shared folder without a clear reason.
- Avoid duplicating UI patterns that already exist; extend or reuse instead.
- Avoid adding dependencies unless the task genuinely requires one and no existing tool covers it — check `package.json` first.
- Keep data access behind stable service boundaries (`src/services/search.ts` and equivalents) — components must not import `@/data/*` domain arrays directly for dynamic listing content.
- Static app configuration (site copy, category taxonomy, nav labels) may remain a direct import — it isn't the same concern as dynamic listing data.
- Do not fabricate API behavior, endpoints, or response shapes that don't exist yet.
- Once async behavior becomes real (a real fetch, not mock data), distinguish loading/empty/error states explicitly — don't assume the happy path.
- Free/Premium UI must eventually gate through a centralized capability/entitlement check, not scattered `if (premium)` conditionals.
- Profession-specific tools (tutor batches, salon booking, etc.) live as modules inside the shared Professional Workspace, not as separate apps.
- Preserve responsive behavior at mobile/tablet/desktop for anything you touch — re-verify at 375px/820px/1440px if you change layout-adjacent code.
- Production-direction changes should not silently alter existing flows — if a change affects an existing journey's behavior, say so explicitly in your report; don't let it be a surprise.
