# Theming

Preferences → Appearance covers focus borders, colors, border radius, gaps, screen-edge
margins and the tab bar, and applies changes live. A color or size change reaches
every place that hint is drawn: window borders, drag previews and overview
thumbnails. Each group has a Reset.

## Gaps

- The gap between tiled windows is **Gap size** (`window-gap-size`, 4) times **Gap
  size multiplier** (`window-gap-size-increment`, 0–32); `Ctrl+Super+=` / `Ctrl+Super+-`
  step the multiplier.
- `window-gap-hidden-on-single` drops the gap around a lone window.
- `window-margin-{top,bottom,left,right}` reserves screen edges for panels and docks.

## Custom CSS

Forge loads `~/.config/forge/stylesheet/forge/stylesheet.css`, copied from the
[bundled stylesheet](../../stylesheet.css) on first run. The bundled file lists every
selector. Hand edits load the next time Forge is enabled (or you log in);
`Super+Shift+r` does not reload CSS.

A release that changes the bundled stylesheet replaces yours with it, keeping your
version as `stylesheet.css.bak`.
