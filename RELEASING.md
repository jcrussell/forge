# Releasing Forge

How to cut a release and submit it to extensions.gnome.org (EGO). Releases are
automated by [`.github/workflows/publish.yml`](.github/workflows/publish.yml):
pushing a tag builds the extension, checksums it, attaches a keyless
build-provenance attestation, and publishes a GitHub Release.

## Versioning & tags

- **Tag scheme:** `v<gnome-major>-<ego-build>`, e.g. `v49-90`. The build number
  tracks the incrementing version EGO assigns on upload.
- Bump `version` in `package.json` to match (it is the human-facing semver; EGO
  assigns the integer `version` in `metadata.json` itself, so we don't set it there).
- Tags are GPG-signed.

## Cut a release

```bash
git tag -s v49-90 -m "v49-90"
git push origin v49-90
```

CI then builds `forge@jmmaranan.com.zip`, generates `SHA256SUMS`, attests
provenance, and creates the GitHub Release with auto-generated notes. To rehearse
without releasing, run the workflow via **Actions → release → Run workflow**
(`workflow_dispatch`) on a branch — it builds and attests but creates no Release.

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
