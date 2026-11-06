---
name: review-branch
description: Maintainer review of our own branch before (or right after) it is pushed as a PR. Same rubric and mechanics as review-pr, minus the untrusted-contributor steps - per-commit mechanism verdicts, every commit passes the gates alone, fail-before tests, local e2e for touched e2e tests, an unanchored independent review of the integrated diff, and fixes folded into the commit they belong to. Use when asked to review our branch, self-review before pushing, or review a PR we authored.
argument-hint: <branch> [--pushed]
---

# Review our own branch

This runs **review-pr**'s procedure (`.claude/skills/review-pr/SKILL.md`) on a branch we
wrote. Read that file and CONTRIBUTING.md § "Getting your change merged" first.
Steps below name review-pr's steps; only the differences are spelled out here.

Own work still gets the full rubric. Each commit can come out Decline or
Reimplement, and per-commit review before integration doesn't replace a look at
the whole branch: commits that pass alone can still interact.

## Mode

- **Unpushed** (default): history is ours to rewrite. Fixes are squashed into the
  commit they belong to (`git commit --fixup=<sha>`, then
  `GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash main`).
- **Pushed** (`--pushed`, or the branch has an open PR): never rewrite. Each fix is
  its own follow-up commit that names the commit it corrects, one concern per
  commit.

## Steps

1. **Skip** review-pr 1 (fetch). Use the local branch; check it is based on
   current `main` (`git merge-base main <branch>`) and rebase first if not
   (unpushed mode only).
2. **Triage** as review-pr 2. Use the commit messages and the `bd` issues they
   close as the "PR description".
3. **Skip** review-pr 3 (safety screen) and every authorship step. The code is ours.
   Still look at any change to `package.json`, hooks, `.github/workflows/` or
   `Makefile` as a change in its own right.
4. **Mechanism analysis and verdict table** as review-pr 4 and 5, one row per
   commit.
5. **History** as review-pr 6.3 (in pushed mode, on a scratch branch).
6. **Gates** as review-pr 7. Also:
   - **E2E tests the branch adds or changes must run locally before handoff**, on
     the default lane at least (`make e2e-test`; other versions with
     `make e2e-test GNOME_VERSION=<n>`). A new e2e test has never run anywhere
     until then.
   - If e2e can't run here, say so in the report. Don't count unrun tests as
     coverage.
7. **Independent review** as review-pr 8, on `git diff main...<branch>`. Also
   withhold the bead bodies and commit-message bodies: for our own branch they
   carry our conclusions. For a large branch, split it by area across a few
   reviewers. Each one sees its commits and the full diff for context.
8. **Fixes** per the mode above (this replaces review-pr 9's single follow-up
   commit). Update docs and file `bd` issues as review-pr 9.
9. **CI** as review-pr 10: confirm the lanes for the touched areas actually ran.

## Report

1. Verdict table and the history check result.
2. Gate results, with e2e lanes run locally (GNOME versions) and anything unrun.
3. Where the independent review disagreed with our root cause or mechanism, and
   how each was settled.
4. Fixes made: the commits they were folded into, or the follow-up commits.
5. A PR description following `.github/pull_request_template.md`, and the push
   commands if push is blocked in the sandbox.
