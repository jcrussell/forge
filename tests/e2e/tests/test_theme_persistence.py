"""
Theme persistence test for Forge (Bug #312 / forge-9sd).

A border/hint colour change must persist to the on-disk stylesheet even when that
file is read-only — which is the state patchCss() left it in, because it copied the
read-only install-dir default and Gio.copy() inherited its perms. Before the fix,
replace_contents() failed silently and the colour was lost.

Drives the real theme-manager path (setCssProperty -> _updateCss -> replace_contents)
via the test bridge, which runs in the gnome-shell process (no GTK prefs UI needed).
"""

import os

from framework.wait import wait_for


def _read(path):
    with open(path, "r", encoding="utf-8") as fh:
        return fh.read()


def _write(path, content):
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(content)


class TestThemePersistence:
    def test_color_change_persists_on_readonly_stylesheet(self, shell_proxy):
        config_dir = shell_proxy.get_config_dir()
        assert config_dir, "could not resolve Forge config dir"
        stylesheet = os.path.join(config_dir, "stylesheet", "forge", "stylesheet.css")
        assert os.path.exists(stylesheet), f"stylesheet not present at {stylesheet}"

        original = _read(stylesheet)
        marker = "rgb(1, 2, 3)"
        assert marker not in original, "test marker unexpectedly already present"

        try:
            # Reproduce the bug's precondition: a read-only user stylesheet.
            os.chmod(stylesheet, 0o444)

            result = shell_proxy.eval(
                "globalThis._forgeTestBridge.setThemeColor('.tiled', 'color', '%s')" % marker
            )
            assert result == "ok", f"setThemeColor returned {result!r}"

            # With the fix, _ensureWritable() flips the file writable and the write lands.
            content = wait_for(
                lambda: _read(stylesheet),
                predicate=lambda c: marker in c,
                message="colour change did not persist to a read-only stylesheet",
            )
            assert marker in content
        finally:
            # Restore writability and original content so later tests are unaffected.
            try:
                os.chmod(stylesheet, 0o644)
            except OSError:
                pass
            _write(stylesheet, original)
