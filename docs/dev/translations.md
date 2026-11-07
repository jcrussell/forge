# Translations (i18n)

Forge is localized with **gettext**, the only translation mechanism GNOME Shell
supports for extensions. GNOME loads compiled catalogs at runtime by the extension's
gettext domain (`gettext-domain: forge` in `metadata.json`), looking up
`locale/<lang>/LC_MESSAGES/forge.mo` inside the installed extension.

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
  `po/<lang>.po`.

### Developer workflow

When you add or change a `_("...")` string:

```bash
make update-pot      # refresh the template
git add po/forge.pot # commit it with your code change
```

That's it for the source side. A language whose `.po` lags the template just falls
back to the English source string at runtime until a translator fills it in;
nothing breaks.

Until [Weblate](#weblate-not-active) is active, run `make update-po` to fold new
strings into every `po/<lang>.po`; translators edit those files directly.

## Weblate (not active)

Hosted Weblate needs the project registered against the canonical repo, so it waits
on upstreaming; until then the `make` targets above are the workflow and `.weblate`
is an inactive placeholder. Setup, once registered (manual, maintainer only):

1. Register on Hosted Weblate (libre hosting) and fill the `<project>/<component>`
   slug into `.weblate`. The API key comes from `WLC_KEY`; never commit it.
2. Create a component: gettext PO, file mask `po/*.po`, template `po/forge.pot`, no
   monolingual base file.
3. Enable the add-ons *Update PO files to match POT*, *Squash Git commits* and
   *Cleanup translation files*.
4. Set version control to **GitHub pull request**, so translations arrive as PRs
   against `main`.

From then on Weblate owns `po/<lang>.po`: don't hand-edit them. Weblate stamps
`POT-Creation-Date` in its own commits ([weblate#5071](https://github.com/WeblateOrg/weblate/issues/5071)),
which doesn't affect local builds.
