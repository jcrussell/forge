# Releasing Forge

How to cut a release and submit it to extensions.gnome.org (EGO). Releases are
automated by [`.github/workflows/publish.yml`](.github/workflows/publish.yml):
pushing a tag builds the extension, checksums it, attaches a keyless
build-provenance attestation, and publishes a GitHub Release.

## Versioning & tags

- **Tag scheme:** `v<gnome-major>-<ego-build>`, e.g. `v49-90`. The build number
  tracks the incrementing version EGO assigns on upload.
- EGO assigns the integer `version` in `metadata.json` itself, so we don't set it
  there. `package.json`'s `version` is npm dev-manifest bookkeeping only — not
  shipped in the zip, not read at runtime — so bumping it is optional.
- Lightweight tags are fine; signing is optional and CI does not check it.

## Cut a release

```bash
git tag v49-90
git push origin v49-90
```

CI then builds `forge@jmmaranan.com.zip`, generates `SHA256SUMS`, attests
provenance, and creates the GitHub Release with auto-generated notes. To rehearse
without releasing, run the workflow via **Actions → release → Run workflow**
(`workflow_dispatch`) on a branch — it builds and attests but creates no Release.

## Pre-releases (betas)

To ship a build for testing without sending it to EGO, add a `-beta.N` or
`-rc.N` suffix to the tag you're heading toward:

```bash
git tag v49-90-beta.1
git push origin v49-90-beta.1
```

CI builds and attests the same zip but marks the GitHub Release as a
**pre-release** (never shown as "Latest"). The suffix keeps the EGO counter
clean: betas never touch EGO, so the eventual bare `v49-90` cut still becomes EGO
build 90.

**Do not upload a beta to EGO.** Only the bare, suffix-free tag is the EGO-bound
release.

## Submit to extensions.gnome.org

EGO has no upload API and human-reviews every submission, so this step is manual:

1. Grab the release's `forge@jmmaranan.com.zip` (or run `make dist` locally — same
   artifact).
2. Upload it at <https://extensions.gnome.org/upload/>, marking the ToS and
   shell-license compliance boxes.
3. EGO assigns the integer `version` and queues the zip for review.

The GitHub attestation and checksum secure the side-load path only; they do not
appear on EGO. GNOME's ecosystem has no author-signing mechanism — EGO
distribution trust comes from its review.

## Verify a published release

```bash
sha256sum -c SHA256SUMS
gh attestation verify forge@jmmaranan.com.zip --repo jcrussell/forge
```
