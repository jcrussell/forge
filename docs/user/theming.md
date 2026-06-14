# Theming & appearance

Most appearance options — border size/color/radius, gaps, margins, tab decoration —
are in **Preferences → Appearance**, no CSS required. For finer control you can
override Forge's stylesheet.

## Preferences

Appearance settings (focus-hint borders, split borders, gaps, screen-edge margins,
tab margins) update live. When you change a focus-hint **color or size**, it
propagates everywhere that hint is drawn: the tiled/stacked/tabbed window borders,
the drag **preview hints**, and the overview / workspace-thumbnail hints. Each hint
group has a **Reset** to restore the gschema default.

## Gaps

- `window-gap-size` (default 4) — space between tiled windows; adjustable live with
  the gap inc/dec shortcuts (`window-gap-size-increment` is the step).
- `window-gap-hidden-on-single` — hide the gap when a workspace has one window.
- `window-margin-{top,bottom,left,right}` — reserve screen-edge space for panels/docks.

## Custom CSS

Forge loads a user stylesheet from:

```
~/.config/forge/stylesheet/forge/stylesheet.css
```

It's seeded from the bundled default on first run (and re-synced by `patchCss` on
update). Edit it and reload with **`Super+Shift+r`**, or log out/in.

Selectors Forge exposes (see the bundled `stylesheet.css` for the full set):

| Selector | What it styles |
| --- | --- |
| `.window-tiled-border` | Border of a tiled window |
| `.window-split-border` | Split-container border |
| `.window-stacked-border` / `.window-tabbed-border` | Stacked / tabbed container border |
| `.window-floated-border` | Floating-window border |
| `.window-tabbed-tab`, `.window-tabbed-tab-active`, `.window-tabbed-tab-icon`, `.window-tabbed-tab-close` | Tab strip elements |
| `.window-tilepreview-tiled` / `-stacked` / `-tabbed` / `-swap` | Drag/drop preview hints |
| `.tiled`, `.split`, `.stacked`, `.tabbed`, `.floated` | Palette classes (color/opacity) |

Border width, color, radius, and opacity are plain CSS properties; colors accept
`rgba(...)` or hex.

> Advanced: the CSS parser and `ThemeManagerBase` API live in `lib/css/` and
> `lib/shared/theme.js` (see [dev/rendering.md](../dev/rendering.md)).
