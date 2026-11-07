# Troubleshooting

## First steps

- **Restart GNOME Shell:** log out and back in (on X11, `Alt+F2`, `r`, Enter also
  works).
- **Check what's enabled:** `gnome-extensions list --enabled` should show
  `forge@jcrussell.github.io`. If it also shows `forge@jmmaranan.com`, two copies are
  tiling; [remove the old one](../../README.md#upgrading-from-forgejmmaranancom).
- **Reload config files:** `Super+Shift+r` ([what it reloads](config.md)).

## A window won't tile, or won't float

Check, in order: a [window rule](rules.md) for its class or title, tiling being on
(`Super+w`), and whether its monitor or workspace is
[excluded](monitors.md#excluding-monitors-and-workspaces) (`Super+Shift+w` toggles
the workspace).

## Stacked or tabbed shortcuts do nothing

The mode is turned off in Preferences → Tiling.

## Debug logs

Release builds don't log. Build from source with `make dev`
([CONTRIBUTING.md](../../CONTRIBUTING.md)), then:

```bash
gsettings set org.gnome.shell.extensions.forge logging-enabled true
gsettings set org.gnome.shell.extensions.forge log-level 5   # DEBUG; 6 TRACE, 7 ALL
journalctl -f -o cat /usr/bin/gnome-shell   # or: make log
```

Set `logging-enabled` back to `false` when done.

GNOME Shell logs JavaScript errors from any build, so the journal is worth checking
either way.

## Known limitations

- Dynamic workspaces are not supported; use a fixed number.
- Portrait monitors are [not fully supported](monitors.md#limitations).

## Reporting a bug

Use the [bug report form](https://github.com/jcrussell/forge/issues/new?template=bug_report.yml);
it asks for what's needed.
