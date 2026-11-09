# Releasing Forge

Releases are GitHub Releases only. Pushing a tag runs
[`publish.yml`](.github/workflows/publish.yml), which builds the zip, checksums it,
attests its provenance and publishes the release.

## Versioning & tags

- **Tag scheme:** CalVer, `vYYYY.M.N` — e.g. `v2026.11.0`, then `v2026.11.1`
  for the next release that month, `v2026.12.0` for the first in December. The
  four-digit year keeps these tags sorting after upstream's old
  `v<gnome-major>-<ego-build>` tags (`v49-90-beta.4`) under version sort.
- The version says *when*, not *what*: breaking changes (a changed default
  keybinding, a config format change, a dropped GNOME version) are flagged in the
  notes instead. Mark the commit breaking with `!`
  ([commit format](CONTRIBUTING.md#commit-messages)) and add migration steps in an
  annotated tag (below).
- Don't set `version` in `metadata.json` (it is EGO's upload counter); the build
  stamps the tag into `version-name`. `package.json`'s `version` isn't shipped.
- Lightweight tags are fine; CI doesn't check signatures.

## Cut a release

```bash
git tag v2026.11.0
git push origin v2026.11.0
```

To rehearse, run **Actions → release → Run workflow** on a branch: it builds,
attests and prints the notes, but publishes nothing.

### Release notes

[`release-notes.sh`](.github/scripts/release-notes.sh) builds the notes from
commit subjects since the previous tag (for a stable tag, the previous stable tag),
grouped by [commit type](CONTRIBUTING.md#commit-messages). `type!:` commits also
go under Breaking Changes; Maintenance and unparsed subjects (Other) are collapsed. Contributors
lists each commit author and `Co-authored-by` co-author (AI and bots excluded) as
an `@handle`, resolved through the GitHub API, or as a plain name when their email
isn't linked to an account.

A release that needs a human note (a changed default, a migration step) gets an
**annotated** tag; its message goes above the generated sections:

```bash
git tag -a v2026.11.0 -m "Stacked/tabbed layouts are now enabled by default."
git push origin v2026.11.0
```

For a longer note, write it in a file. Markdown headings need `--cleanup=verbatim`:
by default git strips lines starting with `#` from tag messages as comments.

```bash
git tag -a --cleanup=verbatim -F notes.md v2026.11.0
```

Preview any range locally:

```bash
./.github/scripts/release-notes.sh HEAD v49-89   # <tag> [previous-tag]
```

Without a logged-in `gh`, the preview lists contributors by name rather than handle.

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

Not used: EGO's [review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html#extensions-must-not-be-ai-generated)
reject AI-generated extensions. The zip is still EGO-shaped (`make dist`).

## Verify a published release

```bash
sha256sum -c SHA256SUMS
gh attestation verify forge@jcrussell.github.io.zip --repo jcrussell/forge
```
