# Translations (i18n)

Forge is localized with **gettext**, the only translation mechanism GNOME Shell
supports for extensions. GNOME loads compiled catalogs at runtime by the extension's
gettext domain (`gettext-domain: forge` in `metadata.json`), looking up
`locale/<lang>/LC_MESSAGES/forge.mo` inside the installed extension.

There is no JSON/inline alternative — the string catalog (`po/`) is inherent to
gettext. What we *do* control is the workflow, so the catalogs don't drift or churn.

## How strings are marked

Wrap every user-facing string in `_()` (the gettext alias). The import differs by
context:

```js
// Extension / shell code (extension.js, lib/extension/*)
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

// Preferences code (prefs.js, lib/prefs/*)
import { gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

const label = _("Tiling");
```

`translator-credits` (`lib/prefs/settings.js`) is the conventional GNOME credits
key — translators fill in their names there; leave the `_("translator-credits")`
call as-is.

## The pipeline

| File | Role | Tracked? |
| --- | --- | --- |
| `po/forge.pot` | Template — every translatable string, no translations. Generated from source. | yes |
| `po/<lang>.po` | One catalog per language (msgid → msgstr). | yes |
| `po/<lang>.mo` | Compiled binary catalog. Build artifact. | no (`.gitignore`) |

Three Makefile targets:

- **`make compilemsgs`** (runs inside `make build`/`dev`/`prod`) — compiles
  `po/*.po` → `.mo` only. **It never rewrites `.po`/`.pot`.** This is the key
  property: a normal build leaves `po/` untouched, so it stops showing as
  "always modified."
- **`make update-pot`** — regenerates `po/forge.pot` from source via `xgettext`.
  Uses `--add-location=file` (file-only source comments, no line numbers) and
  `--sort-by-file` over a sorted file list, and strips `POT-Creation-Date`, so the
  output is **deterministic** — re-running with no string changes is byte-identical.
- **`make update-po`** — `update-pot`, then `msgmerge` the template into each
  `po/<lang>.po`. Used locally to refresh catalogs with new strings; once Weblate
  is active (see below) it does this automatically.

### Developer workflow

When you add or change a `_("...")` string:

```bash
make update-pot      # refresh the template
git add po/forge.pot # commit it with your code change
```

That's it for the source side. A language whose `.po` lags the template just falls
back to the English source string at runtime until a translator fills it in;
nothing breaks.

Until [Weblate is active](#weblate-planned), catalogs are maintained manually: run
`make update-po` to fold new strings into every `po/<lang>.po`, and translators
edit the `.po` files directly. Once Weblate is wired up, **don't hand-edit
`po/<lang>.po`** — it will own them.

## Weblate (planned)

> **Status: not yet active.** Hosting Forge on Weblate needs the project registered
> against the canonical upstream repo ([`forge-ext/forge`](https://github.com/forge-ext/forge)),
> which is blocked on this fork's changes being upstreamed. Until then the manual
> `make update-pot` / `make update-po` workflow above is the source of truth, and the
> `.weblate` file in the repo root is an **inactive placeholder template**. The
> sections below are the intended setup once upstreaming lands.

The plan is to crowd-source translations via [Hosted Weblate](https://hosted.weblate.org)
(free for libre projects). Weblate watches the repo, detects template changes,
propagates new strings into every `po/<lang>.po`, and opens **pull requests against
`main`** with translator contributions. Adding a new language is done entirely in
Weblate — it creates `po/<lang>.po`, which the Makefile's `wildcard po/*.po` picks
up automatically (no `LINGUAS` file needed).

The repo carries a `.weblate` file (config for the [`wlc`](https://docs.weblate.org/en/latest/wlc.html)
CLI); fill in the real `<project>/<component>` slug once registered. The API key is
supplied via the `WLC_KEY` environment variable, never committed.

### Maintainer one-time setup (when upstreamed)

This is a manual, human-only step (cannot be scripted):

1. Register the project on Hosted Weblate (Libre hosting — requires a libre license,
   public repo, and public translations; approval is manual).
2. Create a component:
   - **File format:** gettext PO file
   - **File mask:** `po/*.po`
   - **Template for new translations:** `po/forge.pot`
   - **Monolingual base language file:** *(empty — PO is bilingual)*
3. Enable add-ons: *Update PO files to match POT (msgmerge)*, *Squash Git commits*,
   *Cleanup translation files*.
4. Set the version control to **GitHub pull request** and connect Weblate's GitHub
   integration, so writeback opens PRs from a `weblate/*` branch against `main`.

> Note: Weblate stamps `POT-Creation-Date` in the `.po` files it commits
> ([weblate#5071](https://github.com/WeblateOrg/weblate/issues/5071)). That churn is
> confined to Weblate's own PRs and does not affect local builds.
