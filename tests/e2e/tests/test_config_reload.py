"""Config sync E2E tests: ConfigReload (forge-a34.5) and ConfigExport (forge-og5).

ConfigReload re-reads windows.json overrides into the WindowManager's cached
windowProps; ConfigExport writes the current GSettings to portable config files.
"""

import json
import os

from framework.wait import wait_for

# A wmClass that does not exist in the bundled default windows.json, so its
# presence in the WM's overrides is unambiguous proof the file was re-read.
PROBE_CLASS = "ForgeReloadProbe"


class TestConfigReload:
    def test_reload_reapplies_windows_json(self, shell_proxy):
        """ConfigReload should refresh the WM's cached overrides from windows.json.

        configMgr.windowProps re-parses the file on every read, but the WM keeps a
        cached copy (ext.extWm.windowProps) that only refreshes on reload. So we
        edit the user windows.json, confirm the WM hasn't picked it up yet, trigger
        ConfigReload, and confirm it has.
        """
        config_dir = shell_proxy.get_config_dir()
        assert config_dir, "could not resolve Forge config dir from the extension"
        win_json = os.path.join(config_dir, "config", "windows.json")

        existed = os.path.exists(win_json)
        original = None
        if existed:
            with open(win_json, encoding="utf-8") as f:
                original = f.read()

        try:
            # Baseline: the probe override is absent from the WM's cached overrides.
            assert PROBE_CLASS not in shell_proxy.get_wm_override_classes()

            # Write a user windows.json adding a unique float override.
            os.makedirs(os.path.dirname(win_json), exist_ok=True)
            data = json.loads(original) if original else {"overrides": []}
            data.setdefault("overrides", [])
            data["overrides"].append({"wmClass": PROBE_CLASS, "mode": "float"})
            with open(win_json, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)

            # The file changed, but nothing has told the WM to reload — its cached
            # overrides must NOT include the probe yet.
            assert PROBE_CLASS not in shell_proxy.get_wm_override_classes(), (
                "WM should not see the new override before ConfigReload"
            )

            # Trigger the reload.
            shell_proxy.invoke_forge_action({"name": "ConfigReload"})

            # Now the WM's cached overrides must include the probe (file re-read).
            classes = wait_for(
                shell_proxy.get_wm_override_classes,
                predicate=lambda cs: PROBE_CLASS in cs,
                message="ConfigReload should re-read windows.json into the WM cache",
            )
            assert PROBE_CLASS in classes
        finally:
            # Restore windows.json to its prior state and reload so the probe
            # override does not leak into later tests' configMgr reads.
            if existed and original is not None:
                with open(win_json, "w", encoding="utf-8") as f:
                    f.write(original)
            elif os.path.exists(win_json):
                os.remove(win_json)
            shell_proxy.invoke_forge_action({"name": "ConfigReload"})


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
