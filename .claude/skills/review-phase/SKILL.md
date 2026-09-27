---
name: review-phase
description: Review a completed but not-yet-committed B-17 Portal phase implementation against its stated scope before commit. Use whenever the user asks to review, double-check, or verify a phase's changes are ready to commit.
---

# Review Phase

Use this workflow to independently review a phase's implementation before it is committed. This is a review, not an implementation step — do not fix anything found here unless the user explicitly asks you to.

## Inspect

- **Requirements compliance** — does the actual diff match what the phase was supposed to do? Check against the phase's stated objective (roadmap entry / user's instructions), not against what would be "nice to add."
- **Scope creep** — anything changed that wasn't part of the stated scope, including unrelated cleanup, renames, or "while I was in there" edits.
- **Git diff** — read the actual diff, not just the file list. Confirm every changed line is explained by the phase's objective.
- **Regressions** — does anything that worked before still work? Check adjacent/related flows, not just the new code.
- **TypeScript quality** — no new `any`, no unnecessary non-null assertions, strict mode still green.
- **Component reuse** — did this introduce a new UI pattern where an existing shared component already covers it?
- **Accessibility** — semantic HTML, labels, keyboard operability, focus states for anything new or changed.
- **Responsive/mobile issues** — check 375px/820px/1440px for anything layout-adjacent.
- **State/data-boundary violations** — new code reaching into `@/data/*` directly, or bypassing `src/services/search.ts` / the Zustand stores' intended interfaces.
- **Unnecessary dependencies** — anything added to `package.json` that isn't clearly justified by the phase's actual need.
- **Security-sensitive assumptions** — anything that treats demo auth, client-side state, or mock data as if it were a real security boundary.
- **Dead/unrelated changes** — leftover debug code, commented-out blocks, orphaned files.

## Verify

Run whatever is actually configured in this repo:
- `npm run build`
- `npm run lint`
- tests, if a test suite exists (as of Phase 9A, none does — say so rather than skipping silently if that changes later)

## Verdict

End with exactly one of:

**READY FOR COMMIT**

or

**NEEDS FIXES**, followed by a concrete, itemized list of exactly what must change before it's ready — not vague concerns.

## Constraints

- Do not modify code during a review unless the user explicitly asks you to fix something found.
- Do not commit or push, regardless of verdict.
