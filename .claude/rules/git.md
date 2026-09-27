# Git Rules

- Inspect `git status` before starting any work.
- Inspect the current branch and recent `git log` before starting any work.
- Never work on top of unknown/unexplained uncommitted changes — surface them and ask before proceeding if their origin isn't clear from context.
- Keep one phase/concern per commit. Don't bundle unrelated work into a single commit.
- Never include unrelated files in a commit — review the staged diff, not just the file list.
- Run available verification (build/lint/tests) before recommending a commit.
- Always show `git diff`/`git status` in the final report for a phase, so the user can see exactly what would be committed.
- Do not commit without explicit user approval, even if verification passes.
- Do not push without explicit user approval, even after committing.
- Never rewrite published history (`rebase`, `commit --amend`, force-push) without explicit instruction to do so.
- Avoid destructive commands (`reset --hard`, `clean -f`, `checkout --` over uncommitted work) unless explicitly requested — prefer stashing or asking first.
- The working tree should be clean at phase boundaries — no stray uncommitted changes left behind between phases.
