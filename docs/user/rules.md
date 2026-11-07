# Window rules

Rules float a window that would tile (dialogs, launchers, games) or force-tile one
that would float. Forge ships [default rules](../../config/windows.json) for common
apps.

## Adding a rule

- **Preferences → Windows → Add Floating Window:** a class, optionally a title.
- **`Super+c` / `Super+Shift+c`:** float or tile the focused window or its app; the
  toggle writes the rule.
- **The file** `~/.config/forge/config/windows.json`, then [reload](config.md):

```json
{
  "overrides": [
    { "wmClass": "Conky", "mode": "float" },
    { "wmClass": "jetbrains-idea", "wmTitle": "splash", "mode": "float" },
    { "wmClass": "Calculator", "mode": "tile" }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `wmClass` | Exact, case-sensitive class; commas separate alternatives. |
| `wmTitle` | Title substring. In `float` rules it ignores case, `!` negates and commas separate patterns; in `tile` rules it is one case-sensitive substring. Without `wmClass` it matches any window. |
| `mode` | `float` or `tile`. Required. |
| `wmId` | Written by the per-window toggle for the current session. Don't set it. |

A rule needs `wmClass` or `wmTitle`. Forge ignores a malformed rule; if the whole
file is invalid it uses the default rules, and saves your file as `windows.json.bak`
before it next writes one.

## Precedence

1. A title or per-window `tile` rule always tiles.
2. A title or per-window `float` rule floats.
3. A class `tile` rule tiles the app's normal windows; its dialogs and other
   transient windows still float.
4. Otherwise dialogs, fixed-size windows and class `float` rules float.

The toggles add and remove only single-class and per-window rules; edit comma-list
and title rules in the file. To tile an app a comma-list rule floats (Steam,
Blender), `Super+Shift+c` adds a class `tile` rule, and pressing it again removes it.

## Finding a window's class

Run `xprop WM_CLASS` and click the window; the class is the second string. On
Wayland use Looking Glass (`Alt+F2`, `lg`, Windows tab).

Forge floats a window while it reports no class. Some apps (Anki, the Opera Flatpak)
report one late or never; match those by a specific title:

```json
{ "wmTitle": "- Anki", "mode": "tile" }
```
