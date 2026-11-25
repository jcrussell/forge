"""Config sync E2E tests: ConfigReload (forge-a34.5) and ConfigExport (forge-og5).

ConfigReload re-reads windows.json overrides into the WindowManager's cached
windowProps; ConfigExport writes the current GSettings to portable config files.
"""

import contextlib
import json
import os

from framework.wait import wait_for

# A wmClass that does not exist in the bundled default windows.json, so its
# presence in the WM's overrides is unambiguous proof the file was re-read.
PROBE_CLASS = "ForgeReloadProbe"


@contextlib.contextmanager
def _float_rule_in_windows_json(shell_proxy, wm_class):
    """Add a class float rule to the user's windows.json; restore the file and
    reload afterwards so the rule does not leak into later tests."""
    config_dir = shell_proxy.get_config_dir()
    assert config_dir, "could not resolve Forge config dir from the extension"
    win_json = os.path.join(config_dir, "config", "windows.json")
    original = None
    if os.path.exists(win_json):
        with open(win_json, encoding="utf-8") as f:
            original = f.read()
    try:
        os.makedirs(os.path.dirname(win_json), exist_ok=True)
        data = json.loads(original) if original else {"overrides": []}
        data.setdefault("overrides", []).append({"wmClass": wm_class, "mode": "float"})
        with open(win_json, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        yield
    finally:
        if original is not None:
            with open(win_json, "w", encoding="utf-8") as f:
                f.write(original)
        elif os.path.exists(win_json):
            os.remove(win_json)
        shell_proxy.invoke_forge_action({"name": "ConfigReload"})


class TestConfigReload:
    def test_reload_reapplies_windows_json(self, shell_proxy):
        """ConfigReload should refresh the WM's cached overrides from windows.json.

        configMgr.windowProps re-parses the file on every read, but the WM keeps a
        cached copy (ext.extWm.windowProps) that only refreshes on reload. So we
        edit the user windows.json, confirm the WM hasn't picked it up yet, trigger
        ConfigReload, and confirm it has.
        """
        # Baseline: the probe override is absent from the WM's cached overrides.
        assert PROBE_CLASS not in shell_proxy.get_wm_override_classes()

        with _float_rule_in_windows_json(shell_proxy, PROBE_CLASS):
            # The file changed, but nothing has told the WM to reload — its cached
            # overrides must NOT include the probe yet.
            assert PROBE_CLASS not in shell_proxy.get_wm_override_classes(), (
                "WM should not see the new override before ConfigReload"
            )

            shell_proxy.invoke_forge_action({"name": "ConfigReload"})

            # Now the WM's cached overrides must include the probe (file re-read).
            classes = wait_for(
                shell_proxy.get_wm_override_classes,
                predicate=lambda cs: PROBE_CLASS in cs,
                message="ConfigReload should re-read windows.json into the WM cache",
            )
            assert PROBE_CLASS in classes

    def test_reload_applies_a_new_rule_to_open_windows(self, shell_proxy, two_windows):
        """A rule added to windows.json floats the app's open windows on reload,
        not only at the next unrelated render."""
        wm_class = two_windows[0].get("wmClass")
        assert shell_proxy.count_tiled_windows_of_class(wm_class) == 2

        with _float_rule_in_windows_json(shell_proxy, wm_class):
            shell_proxy.invoke_forge_action({"name": "ConfigReload"})
            tiled = wait_for(
                lambda: shell_proxy.count_tiled_windows_of_class(wm_class),
                predicate=lambda n: n == 0,
                message="open windows did not follow the reloaded rule",
            )
            assert tiled == 0


class TestConfigExport:
    def test_export_writes_portable_config(self, shell_proxy, restore_settings):
        """ConfigExport should write settings.json + keybindings.json and flip sync on.

        ConfigExport -> configSync.enablePortableConfig() -> exportAll(), which
        writes both portable files into confDir/config and sets
        config-file-sync-enabled=true (config-sync.js).
        """
        config_dir = shell_proxy.get_config_dir()
        assert config_dir, "could not resolve Forge config dir from the extension"
        settings_json = os.path.join(config_dir, "config", "settings.json")
        keybindings_json = os.path.join(config_dir, "config", "keybindings.json")

        # Capture prior state so the test leaves no portable config behind.
        saved = {}
        for path in (settings_json, keybindings_json):
            saved[path] = open(path, encoding="utf-8").read() if os.path.exists(path) else None
        # Recording the flag via restore_settings ensures it's reset on teardown.
        restore_settings.set("config-file-sync-enabled", False)

        try:
            shell_proxy.invoke_forge_action({"name": "ConfigExport"})

            for path in (settings_json, keybindings_json):
                assert os.path.exists(path), f"ConfigExport should write {path}"
            wait_for(
                lambda: restore_settings.get("config-file-sync-enabled"),
                predicate=bool,
                message="ConfigExport should enable config-file-sync-enabled",
            )
        finally:
            for path, content in saved.items():
                if content is None:
                    if os.path.exists(path):
                        os.remove(path)
                else:
                    with open(path, "w", encoding="utf-8") as f:
                        f.write(content)
