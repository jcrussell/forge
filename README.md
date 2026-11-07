# Forge (maintained by Claude)

[![CI](https://github.com/jcrussell/forge/actions/workflows/testing.yml/badge.svg)](https://github.com/jcrussell/forge/actions/workflows/testing.yml)
[![codecov](https://codecov.io/github/jcrussell/forge/graph/badge.svg?token=MFNOBH5D4L)](https://codecov.io/github/jcrussell/forge)

> [!NOTE]
> Maintained by Claude, used daily by [@jcrussell](https://github.com/jcrussell).
> This fork ships under its own UUID and versioning for now; the hope is to merge it
> back upstream ([discussion](https://github.com/orgs/forge-ext/discussions/501)).
> PRs welcome.

i3/sway-style tiling for GNOME Shell 45–51, on X11 and Wayland. A fork of
[Forge](https://github.com/forge-ext/forge).

![Forge tiling a GNOME desktop](https://user-images.githubusercontent.com/348125/146386593-8f53ea8b-2cf3-4d44-a613-bbcaf89f9d4a.png)

- Tree-based tiling: nested horizontal/vertical splits, stacked and tabbed
  containers, monocle. See [layouts](docs/user/layouts.md).
- Vim-style keyboard control with an on-screen cheatsheet. See
  [keybindings](docs/user/keybindings.md).
- Drag-and-drop tiling, floating windows and per-app [window rules](docs/user/rules.md).
- Per-monitor, per-workspace trees. See [multi-monitor](docs/user/monitors.md).
- Settings and keybindings as [portable JSON](docs/user/config.md).

## Install

Download `forge@jcrussell.github.io.zip` and `SHA256SUMS` from the
[latest release](https://github.com/jcrussell/forge/releases/latest), then:

```bash
sha256sum -c SHA256SUMS    # optional: verify the download
gh attestation verify forge@jcrussell.github.io.zip --repo jcrussell/forge   # optional: verify provenance
gnome-extensions install --force forge@jcrussell.github.io.zip
# log out and back in so GNOME Shell sees the extension, then:
gnome-extensions enable forge@jcrussell.github.io
```

`enable` reports "does not exist" until the shell has rescanned, hence the log-out
in between. To build from source instead, see [CONTRIBUTING.md](CONTRIBUTING.md).

### Upgrading from `forge@jmmaranan.com`

Upstream Forge and this fork before `v2026.11.0` use the UUID `forge@jmmaranan.com`.
Remove that copy first, or both tile at once:

```bash
gnome-extensions uninstall forge@jmmaranan.com
```

For a distro-packaged copy, uninstall the package (or
`gnome-extensions disable forge@jmmaranan.com`). Settings and `~/.config/forge`
carry over.

## Use

Press **`Super+Shift+/`** for the cheatsheet of your current shortcuts and
**`Super+.`** for preferences. Everything else is in the [user guide](docs/README.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Credits

- [@jmmaranan](https://github.com/jmmaranan) and the
  [upstream contributors](https://github.com/forge-ext/forge/graphs/contributors),
  who created Forge
- Michael Stapelberg and contributors for i3
- System76 and contributors for pop-shell
- ReworkCSS and contributors for css-parse/css-stringify
