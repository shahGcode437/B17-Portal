---
name: implement-phase
description: Reusable workflow for implementing a single defined B-17 Portal development phase — inspect, plan, implement only the approved scope, verify, and report. Use whenever the user asks to implement/start/build a specific phase (Phase 9B, Phase 9C, etc.) of the B-17 Portal roadmap.
---

# Implement Phase

Use this workflow for implementing any single, defined phase of B-17 Portal's development (Phase 9B onward, and any later phase). It is intentionally generic — the phase's actual objective and scope come from the user's request and the project's own memory files, not from this skill.

## Steps

1. **Read project memory.** Read `CLAUDE.md`, `docs/development/CURRENT_STATE.md`, `docs/development/ROADMAP.md`, and `docs/development/DECISIONS.md`.
2. **Read relevant requirements.** Check `/docs` for anything the phase touches (Master Specification, UI/UX Spec, etc.) and the roadmap entry for this specific phase.
3. **Inspect the current implementation.** Read the actual files the phase will likely touch — do not assume prior summaries are still accurate; verify against the live repo.
4. **Inspect Git state.** Run `git status` and recent `git log`. Confirm the working tree is clean before starting; if it isn't, surface that before proceeding (see `.claude/rules/git.md`).
5. **Restate the phase objective/scope** back before writing any code — what's in scope, what's explicitly out, per the roadmap and the user's actual instructions for this phase.
6. **Identify files likely affected** before editing, and note anything that looks like it would require touching code outside the stated scope — flag it rather than silently expanding scope.
7. **Implement only the approved scope.** Follow `.claude/rules/frontend.md`. Do not start a later phase's work even if it seems convenient to bundle.
8. **Avoid unrelated refactors and new dependencies** — check `package.json` before assuming something needs installing; prefer existing patterns.
9. **Verify:** run the build, lint, and any configured tests. If something has no test suite, say so rather than skipping silently.
10. **Review the git diff** — confirm only the intended files changed, and that the diff matches what was actually asked for.
11. **Report**, covering:
    - what changed and why
    - exact files changed
    - key design decisions and why (especially anything with more than one reasonable approach)
    - verification results (build/lint/test)
    - risks or known issues introduced or left open
    - `git status` / `git diff --stat`
12. **Do not commit or push.** Stop after the report and wait for explicit approval, per `.claude/rules/git.md`.
