# Portable config

Forge can mirror its settings to `settings.json` and its keybindings to
`keybindings.json` in `~/.config/forge/config/`, next to the
[window rules](rules.md) in `windows.json`. The files are plain JSON, so they diff
cleanly in a dotfiles repo. GSettings stays the live source; the files are an
import/export layer.

- **Export:** Preferences → Portability → Export current settings. This also turns
  on **Auto-sync changes**, which rewrites the files whenever a setting changes.
- **Reload:** Preferences → Portability → Import from files, or `Super+Shift+r`,
  which re-reads all three files. It doesn't reload the stylesheet or rebuild the
  tree.
- **On startup** Forge imports a file only if something else changed it since Forge
  last wrote or read it, so a file Forge wrote never reverts newer settings.

**Open config directory** on the same page opens the folder. To move a setup to
another machine, export, copy the `*.json` files to the same
directory there, and import (or log in).
