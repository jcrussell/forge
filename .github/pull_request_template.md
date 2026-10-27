<!--
Reviewed against CONTRIBUTING.md § "Getting your change merged": fit, mechanism,
correctness. Each change ends as merge as-is, fix-merge, reimplement, or decline.
Bundled PRs are judged commit by commit, so keep one concern per commit.
-->

## What and why

<!-- The problem, from the user's point of view. Link the issue if there is one. -->

## Fit

<!-- How does i3/sway behave here, and does this match it? Any GNOME-version or X11/Wayland limits? -->

## Root cause and mechanism

<!--
For each fix: the root cause in one sentence, and where you fixed it and why
that layer (e.g. a Compat shim, the render pipeline, a tree mutation). If you
added a timeout, guard or flag, explain why fixing the root cause wasn't possible.
-->

## Tests

<!-- What was added, and confirmation that it fails without the change. Unit, e2e, or manual (which GNOME version, X11/Wayland). -->

## Checklist

- [ ] `npm test`, `npm run lint`, `npm run lint:src`, `npm run typecheck` pass
- [ ] New tests fail without the change
- [ ] One concern per commit; messages say what and why
- [ ] Docs / version lists / CI matrix updated if affected
- [ ] AI-assisted (tool: \_\_\_). Fine, just say so
