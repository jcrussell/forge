# Releasing Forge

How to cut a release. Releases are distributed only as GitHub Releases; this
fork is not published on extensions.gnome.org (EGO). Releases are automated by
[`.github/workflows/publish.yml`](.github/workflows/publish.yml): pushing a tag builds the extension, checksums it, attaches a keyless
build-provenance attestation, and publishes a GitHub Release.

## Versioning & tags

- **Tag scheme:** CalVer, `vYYYY.M.N` — e.g. `v2026.11.0`, then `v2026.11.1`
  for the next release that month, `v2026.12.0` for the first in December. The
  four-digit year keeps these tags sorting after upstream's old
  `v<gnome-major>-<ego-build>` tags (`v49-90-beta.4`) under version sort.
- The version says *when*, not *what*: breaking changes (a changed default
  keybinding, a config format change, a dropped GNOME version) are flagged in the
  notes instead. Mark the commit `type!:` (e.g. `feat!: ...`) and it is listed
  under **Breaking Changes**; add migration steps in an annotated tag (below).
- We don't set `version` in `metadata.json` (it is EGO's upload counter).
  `package.json`'s `version` is npm dev-manifest bookkeeping only — not shipped
  in the zip, not read at runtime — so bumping it is optional.
- Lightweight tags are fine; signing is optional and CI does not check it.

## Cut a release

```bash
git tag v2026.11.0
git push origin v2026.11.0
```

CI then builds `forge@jmmaranan.com.zip`, generates `SHA256SUMS`, attests
provenance, and creates the GitHub Release with auto-generated notes. To rehearse
without releasing, run the workflow via **Actions → release → Run workflow**
(`workflow_dispatch`) on a branch — it builds and attests but creates no Release.
The notes are still generated there, so the step log shows exactly what a real
tag would publish.

### Release notes

Notes are generated from **commit subjects**, not PRs, by
[`.github/scripts/release-notes.sh`](.github/scripts/release-notes.sh): commits
since the previous `v*` tag (for a stable tag, the previous *stable* tag, so
betas don't hide earlier changes) are bucketed by conventional-commit type into
Features / Bug Fixes / Documentation & Translations / Maintenance (plus Breaking
Changes for `type!:` commits, listed first), with anything that doesn't parse listed under Other so nothing is silently dropped. GitHub's
built-in `generate_release_notes` is PR-derived and this repo commits straight to
`main`, so it produced empty bodies (`v49-90-beta.1` and `beta.2` shipped with just
a compare link).

Nothing needs maintaining per release. When a release *does* need a human note —
a changed default, a migration step — put it in an **annotated** tag and it
becomes the prelude above the generated sections:

```bash
git tag -a v2026.11.0 -m "Stacked/tabbed layouts are now enabled by default."
git push origin v2026.11.0
```

Preview any range locally:

```bash
./.github/scripts/release-notes.sh HEAD v49-89   # <tag> [previous-tag]
```

## Pre-releases (betas)

To ship a build for testing, add a `-beta.N` or `-rc.N` suffix to the tag you're
heading toward:

```bash
git tag v2026.11.0-beta.1
git push origin v2026.11.0-beta.1
```

CI builds and attests the same zip but marks the GitHub Release as a
**pre-release** (never shown as "Latest"). Only `-beta` and `-rc` are recognised:
any other suffix (`-alpha.1`) would publish as a stable release.

## extensions.gnome.org

Not a distribution channel for this fork: EGO's
[review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html#extensions-must-not-be-ai-generated)
reject AI-generated extensions, and this fork is developed largely with AI agents. The zip is still EGO-shaped (`make dist`), so nothing
here precludes it. The GitHub attestation and checksum secure the side-load path;
GNOME's ecosystem has no author-signing mechanism.

## Verify a published release

```bash
sha256sum -c SHA256SUMS
gh attestation verify forge@jmmaranan.com.zip --repo jcrussell/forge
```
