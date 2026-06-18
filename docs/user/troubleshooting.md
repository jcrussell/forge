# Troubleshooting

## First steps

- **Reload config** — `Super+Shift+r` re-reads `windows.json` / `keybindings.json`
  from disk without restarting.
- **Restart GNOME Shell** — on X11, `Alt+F2` → `r` → Enter. On Wayland, log out and
  back in.
- **Check it's enabled** — `gnome-extensions list --enabled` should include
  `forge@jmmaranan.com`.

## A window won't tile (or won't float)

It probably matches a rule. Check **Preferences → Windows** and
`~/.config/forge/config/windows.json` for an override on its class, and confirm
`tiling-mode-enabled` is on and the workspace/monitor isn't excluded
(`workspace-skip-tile` / `monitor-skip-tile`). See [rules.md](rules.md) and
[monitors.md](monitors.md).

## Stacked / tabbed shortcuts do nothing

Stacked and tabbed are **on by default**. If the shortcuts no-op, the modes were
turned off — confirm `stacked-tiling-mode-enabled` / `tabbed-tiling-mode-enabled`
are enabled in **Preferences → Tiling → Behavior**. See [layouts.md](layouts.md).

## Enabling debug logs

Logging is **off by default** and only active in development builds. Turn it on:

```bash
gsettings set org.gnome.shell.extensions.forge logging-enabled true
gsettings set org.gnome.shell.extensions.forge log-level 5   # 0=OFF … 5=DEBUG 6=TRACE 7=ALL
```

Then watch the logs:

```bash
# X11
journalctl -f -o cat /usr/bin/gnome-shell
# or, generally
journalctl -f -u gnome-shell        # follow
journalctl -e -u gnome-shell        # jump to the end (Wayland)
```

(`make log` wraps this during development.) Set `log-level` back to `0` when done.

## Reporting a bug

Include your GNOME version (`gnome-shell --version`), session type (X11/Wayland),
the steps to reproduce, and any relevant `journalctl` output. File issues against
the fork: <https://github.com/jcrussell/forge/issues>.

## Known limitations

No dynamic workspaces; no full vertical-monitor support (see
[monitors.md](monitors.md)).
