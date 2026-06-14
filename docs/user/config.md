# Portable configuration

Forge can mirror your settings and keybindings to plain JSON files so you can back
them up, version-control them, or copy them to another machine.

## Where config lives

```
~/.config/forge/config/
├── settings.json       # mirror of Forge GSettings (appearance, behavior, …)
├── keybindings.json    # mirror of keybindings
└── windows.json        # float/tile window rules (see rules.md)
```

GSettings remains the live source of truth; these files are an import/export layer.

## Export / import

In **Preferences → Portability**:

- **Open config directory** — opens the folder above in your file manager.
- **Export current settings** — writes your current GSettings to `settings.json` /
  `keybindings.json` (with "Last export" timestamp).
- **Import** — reads those files back into GSettings ("Last import" timestamp).

On startup, Forge's config sync imports any present files automatically, so dropping
a known-good `settings.json`/`keybindings.json` into the config dir and restarting
applies it. `windows.json` is reloaded live with **`Super+Shift+r`**.

## Moving config between machines

1. On the source machine: **Export current settings**.
2. Copy `~/.config/forge/config/*.json` to the same path on the target.
3. On the target: **Import** (or just restart GNOME Shell — sync imports on enable).

Because the files are plain JSON, they diff cleanly and are safe to keep in a
dotfiles repo.
