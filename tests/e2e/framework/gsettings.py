"""
GSettings manipulation for Forge E2E tests.

Provides utilities to read and modify Forge extension settings
for testing different configurations.
"""

import subprocess
from typing import Any, Dict, List, Optional, Union

import gi

gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib


class GSettingsError(Exception):
    """Exception raised when GSettings operation fails."""

    pass


class ForgeSettings:
    """
    Interface to Forge GSettings for testing.

    Allows reading and modifying Forge extension settings
    to test different configurations.
    """

    SCHEMA_ID = "org.gnome.shell.extensions.forge"
    KEYBINDINGS_SCHEMA_ID = "org.gnome.shell.extensions.forge.keybindings"

    def __init__(self, schema_dir: Optional[str] = None):
        """
        Initialize ForgeSettings.

        Args:
            schema_dir: Optional path to schemas directory.
                       If None, uses system schemas.
        """
        self._settings: Optional[Gio.Settings] = None
        self._keybinding_settings: Optional[Gio.Settings] = None
        self._schema_dir = schema_dir
        self._original_values: Dict[str, Any] = {}
        self._original_keybindings: Dict[str, Any] = {}

    def _get_schema_source(self) -> Gio.SettingsSchemaSource:
        """Get the schema source."""
        if self._schema_dir:
            return Gio.SettingsSchemaSource.new_from_directory(
                self._schema_dir,
                Gio.SettingsSchemaSource.get_default(),
                False,
            )
        return Gio.SettingsSchemaSource.get_default()

    def connect(self) -> None:
        """Connect to Forge GSettings."""
        try:
            schema_source = self._get_schema_source()

            # Main settings
            schema = schema_source.lookup(self.SCHEMA_ID, True)
            if not schema:
                raise GSettingsError(f"Schema '{self.SCHEMA_ID}' not found")
            self._settings = Gio.Settings.new_full(schema, None, None)

            # Keybindings settings
            kb_schema = schema_source.lookup(self.KEYBINDINGS_SCHEMA_ID, True)
            if kb_schema:
                self._keybinding_settings = Gio.Settings.new_full(kb_schema, None, None)

        except GLib.Error as e:
            raise GSettingsError(f"Failed to connect to GSettings: {e.message}")

    def disconnect(self) -> None:
        """Disconnect and restore original values."""
        self.restore_all()
        self._settings = None
        self._keybinding_settings = None

    def get(self, key: str) -> Any:
        """
        Get a setting value.

        Args:
            key: The setting key.

        Returns:
            The setting value.

        Raises:
            GSettingsError: If key doesn't exist.
        """
        if not self._settings:
            raise GSettingsError("Not connected to GSettings")

        try:
            return self._settings.get_value(key).unpack()
        except GLib.Error as e:
            raise GSettingsError(f"Failed to get '{key}': {e.message}")

    def set(self, key: str, value: Any) -> None:
        """
        Set a setting value.

        Stores the original value for later restoration.

        Args:
            key: The setting key.
            value: The value to set.

        Raises:
            GSettingsError: If setting fails.
        """
        if not self._settings:
            raise GSettingsError("Not connected to GSettings")

        # Store original value for restoration
        if key not in self._original_values:
            try:
                self._original_values[key] = self._settings.get_value(key)
            except GLib.Error:
                pass

        try:
            # Convert Python value to GLib.Variant
            variant = self._python_to_variant(key, value)
            self._settings.set_value(key, variant)
        except GLib.Error as e:
            raise GSettingsError(f"Failed to set '{key}': {e.message}")

    def _python_to_variant(self, key: str, value: Any) -> GLib.Variant:
        """Convert Python value to GLib.Variant based on schema type."""
        schema = self._settings.get_property("settings-schema")
        key_info = schema.get_key(key)
        variant_type = key_info.get_value_type().dup_string()

        if variant_type == "b":
            return GLib.Variant.new_boolean(bool(value))
        elif variant_type == "i":
            return GLib.Variant.new_int32(int(value))
        elif variant_type == "u":
            return GLib.Variant.new_uint32(int(value))
        elif variant_type == "d":
            return GLib.Variant.new_double(float(value))
        elif variant_type == "s":
            return GLib.Variant.new_string(str(value))
        elif variant_type == "as":
            return GLib.Variant.new_strv(list(value))
        else:
            # Fall back to trying to create variant directly
            return GLib.Variant(variant_type, value)

    def restore(self, key: str) -> None:
        """
        Restore a setting to its original value.

        Args:
            key: The setting key to restore.
        """
        if key in self._original_values and self._settings:
            try:
                self._settings.set_value(key, self._original_values[key])
                del self._original_values[key]
            except GLib.Error:
                pass

    def restore_all(self) -> None:
        """Restore all modified settings to original values."""
        if self._settings:
            for key, value in list(self._original_values.items()):
                try:
                    self._settings.set_value(key, value)
                except GLib.Error:
                    pass
            self._original_values.clear()

        if self._keybinding_settings:
            for key, value in list(self._original_keybindings.items()):
                try:
                    self._keybinding_settings.set_value(key, value)
                except GLib.Error:
                    pass
            self._original_keybindings.clear()

    def reset(self, key: str) -> None:
        """
        Reset a setting to its default value.

        Args:
            key: The setting key to reset.
        """
        if not self._settings:
            raise GSettingsError("Not connected to GSettings")

        # Store original for restoration
        if key not in self._original_values:
            try:
                self._original_values[key] = self._settings.get_value(key)
            except GLib.Error:
                pass

        self._settings.reset(key)

    # Convenience methods for common settings

    def set_tiling_mode_enabled(self, enabled: bool) -> None:
        """Enable or disable tiling mode."""
        self.set("tiling-mode-enabled", enabled)

    def set_float_always_on_top(self, enabled: bool) -> None:
        """Set whether floating windows are always on top."""
        self.set("float-always-on-top-enabled", enabled)

    def set_stacked_tiling_mode_enabled(self, enabled: bool) -> None:
        """Enable or disable stacked tiling mode."""
        self.set("stacked-tiling-mode-enabled", enabled)

    def set_tabbed_tiling_mode_enabled(self, enabled: bool) -> None:
        """Enable or disable tabbed tiling mode."""
        self.set("tabbed-tiling-mode-enabled", enabled)

    def set_preview_hint_enabled(self, enabled: bool) -> None:
        """Enable or disable tiling preview hints."""
        self.set("preview-hint-enabled", enabled)

    def set_focus_border_toggle(self, enabled: bool) -> None:
        """Enable or disable focus border."""
        self.set("focus-border-toggle", enabled)

    def set_window_gap_size(self, size: int) -> None:
        """Set the gap size between windows."""
        self.set("window-gap-size", size)

    def set_window_gap_hidden_on_single(self, enabled: bool) -> None:
        """Set whether to hide gaps when only one window is present."""
        self.set("window-gap-hidden-on-single", enabled)

    # Keybinding methods

    def get_keybinding(self, action: str) -> List[str]:
        """
        Get the keybinding for an action.

        Args:
            action: The action name (e.g., 'window-focus-left').

        Returns:
            List of keybinding strings.
        """
        if not self._keybinding_settings:
            raise GSettingsError("Keybinding settings not available")

        try:
            return self._keybinding_settings.get_strv(action)
        except GLib.Error as e:
            raise GSettingsError(f"Failed to get keybinding '{action}': {e.message}")

    def set_keybinding(self, action: str, keybindings: List[str]) -> None:
        """
        Set the keybinding for an action.

        Args:
            action: The action name.
            keybindings: List of keybinding strings.
        """
        if not self._keybinding_settings:
            raise GSettingsError("Keybinding settings not available")

        # Store original
        if action not in self._original_keybindings:
            try:
                self._original_keybindings[action] = (
                    self._keybinding_settings.get_value(action)
                )
            except GLib.Error:
                pass

        try:
            self._keybinding_settings.set_strv(action, keybindings)
        except GLib.Error as e:
            raise GSettingsError(f"Failed to set keybinding '{action}': {e.message}")

    def set_keybinding_string(self, key: str, value: str) -> None:
        """Set a STRING key in the keybindings schema (e.g. mod-mask-mouse-tile).

        set_keybinding() is strv-only; this covers the schema's plain string
        keys. The original value is captured for restore_all() the same way.
        """
        if not self._keybinding_settings:
            raise GSettingsError("Keybinding settings not available")

        if key not in self._original_keybindings:
            try:
                self._original_keybindings[key] = self._keybinding_settings.get_value(key)
            except GLib.Error:
                pass

        try:
            self._keybinding_settings.set_string(key, value)
        except GLib.Error as e:
            raise GSettingsError(f"Failed to set keybinding string '{key}': {e.message}")

    def disable_keybinding(self, action: str) -> None:
        """
        Disable a keybinding.

        Args:
            action: The action name to disable.
        """
        self.set_keybinding(action, [])

    def enable_default_keybindings(self) -> None:
        """Reset all keybindings to defaults."""
        if not self._keybinding_settings:
            return

        # Get all keys and reset them
        schema = self._keybinding_settings.get_property("settings-schema")
        for key in schema.list_keys():
            self._keybinding_settings.reset(key)


def gsettings_cli_get(schema: str, key: str) -> str:
    """
    Get a GSettings value using the gsettings CLI tool.

    Useful as a fallback when PyGObject isn't available.

    Args:
        schema: The schema ID.
        key: The key to get.

    Returns:
        The value as a string.
    """
    try:
        result = subprocess.run(
            ["gsettings", "get", schema, key],
            capture_output=True,
            text=True,
            check=True,
        )
        return result.stdout.strip()
    except subprocess.CalledProcessError as e:
        raise GSettingsError(f"gsettings get failed: {e.stderr}")


def gsettings_cli_set(schema: str, key: str, value: str) -> None:
    """
    Set a GSettings value using the gsettings CLI tool.

    Args:
        schema: The schema ID.
        key: The key to set.
        value: The value as a string (must be in GSettings format).
    """
    try:
        subprocess.run(
            ["gsettings", "set", schema, key, value],
            capture_output=True,
            text=True,
            check=True,
        )
    except subprocess.CalledProcessError as e:
        raise GSettingsError(f"gsettings set failed: {e.stderr}")
