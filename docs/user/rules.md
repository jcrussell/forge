# Window rules

Rules tell Forge to **float** a window that would normally tile (dialogs, launchers,
games), or to **force-tile** one that would normally float. Forge ships ~40 default
rules for common apps (JetBrains splashes, Conky, ddterm, GNOME setup dialogs, …).

## Two ways to add a rule

- **Preferences → Windows** — "Add Floating Window": type the window class (and
  optionally a title); Forge saves the rule. This is the easy path.
- **Toggle shortcuts** — the per-window and per-class float toggles (see
  [keybindings](keybindings.md#common-defaults)) write a rule for you.

You can also edit the file directly.

## The file: `~/.config/forge/config/windows.json`

```json
{
  "overrides": [
    { "wmClass": "Conky", "mode": "float" },
    { "wmClass": "jetbrains-idea", "wmTitle": "splash", "mode": "float" },
    { "wmClass": "Calculator", "mode": "tile" }
  ]
}
```

Each override:

| Field | Required | Meaning |
| --- | --- | --- |
| `wmClass` | one of `wmClass`/`wmTitle` | Window class to match. **Exact** match (case-sensitive); comma-separates a list of exact classes. |
| `wmTitle` | one of `wmClass`/`wmTitle` | Window title. Substring; `!` prefix negates; comma-separates multiple patterns. A rule with no `wmClass` matches every window whose title contains it. |
| `mode` | yes | `float` = keep out of tiling; `tile` = force into tiling. |
| `wmId` | — | Runtime-only (written by the per-window toggle); don't set by hand. |

After hand-editing, reload with **`Super+Shift+r`**. If the file is not valid JSON,
Forge uses the bundled rules instead, and the next rule change saves your file as
`windows.json.bak` before replacing it.

## Finding a window's class

```bash
xprop WM_CLASS      # then click the window
```

Use the **second** string it prints (the class), or read it from GNOME Looking
Glass (`Alt+F2` → `lg`).

Some apps (Anki, the Opera Flatpak) report no class when their window first
appears, or never do, and Forge floats a window while it has no class. To tile one,
match it by title instead, with a pattern specific enough not to catch other
windows:

```json
{ "wmTitle": "- Anki", "mode": "tile" }
```

> Precedence: a `tile` override for a window/class wins over float-by-type and float
> rules, so you can force-tile one window of an otherwise-floating class. A
> per-window toggle never removes a class-wide rule. The per-class toggle only
> adds or removes single-class rules: it never deletes a comma-list or title rule,
> or another window's per-window rule. To tile an app a comma-list rule floats
> (Steam, Blender), it adds a class `tile` rule, and the next press removes it
> again. A title rule outranks class rules, so change those in the file instead.
