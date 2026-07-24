// Gtk imports
import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import GObject from "gi://GObject";

// Gnome imports
import { gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

// Extension imports
import { PreferencesPage, RemoveItemRow, ResetButton } from "./widgets.js";
import { ConfigManager } from "../shared/settings.js";
import {
  hasOverride,
  removeOverride,
  sortFloatOverrides,
  floatRowSubtitle,
} from "./floating-overrides.js";

export class FloatingPage extends PreferencesPage {
  static {
    GObject.registerClass(this);
  }

  constructor({ settings, dir }) {
    super({ title: _("Windows"), icon_name: "window-symbolic" });

    this.settings = settings;
    this.configMgr = new ConfigManager({ dir });

    // Add Rule section
    this.wmClassEntry = new Adw.EntryRow({ title: _("Window Class") });
    this.wmTitleEntry = new Adw.EntryRow({ title: _("Window Title (optional)") });

    const addButton = new Gtk.Button({
      label: _("Add"),
      css_classes: ["suggested-action"],
      valign: Gtk.Align.CENTER,
    });
    addButton.connect("clicked", () => this.onAddHandler());

    const addButtonRow = new Adw.ActionRow();
    addButtonRow.add_suffix(addButton);

    this.add_group({
      title: _("Add Floating Window"),
      description: _(
        "Add a rule to exclude windows from tiling. Use xprop WM_CLASS to find window class."
      ),
      children: [this.wmClassEntry, this.wmTitleEntry, addButtonRow],
    });

    this.searchEntry = new Gtk.SearchEntry({
      placeholder_text: _("Search windows..."),
      hexpand: true,
      margin_start: 12,
      margin_end: 12,
      margin_top: 8,
      margin_bottom: 8,
    });
    this.searchEntry.connect("search-changed", () => this.onSearchChanged());

    const searchRow = new Adw.PreferencesRow({
      child: this.searchEntry,
      activatable: false,
      selectable: false,
    });

    // Existing floating windows list (sorted)
    let overrides = this.configMgr.windowProps.overrides;
    this.rows = this.loadItemsFromConfig(overrides);

    this.floatingWindowGroup = this.add_group({
      title: _("Floating Windows"),
      description: _("Windows that will not be tiled"),
      header_suffix: new ResetButton({ onReset: () => this.onResetHandler() }),
      children: [searchRow, ...this.rows],
    });
  }

  onSearchChanged() {
    const searchText = this.searchEntry.get_text().toLowerCase();
    for (const row of this.rows) {
      const title = row.get_title()?.toLowerCase() || "";
      const subtitle = row.get_subtitle()?.toLowerCase() || "";
      const visible = !searchText || title.includes(searchText) || subtitle.includes(searchText);
      row.set_visible(visible);
    }
  }

  loadItemsFromConfig(overrides) {
    // Filter to float mode and sort by display key (handles classless rules).
    const floatOverrides = sortFloatOverrides(overrides);

    return floatOverrides.map((override) => {
      return new RemoveItemRow({
        title: override.wmTitle ?? override.wmClass,
        subtitle: floatRowSubtitle(override, _("Title-only rule")),
        // Close over this specific override so removal targets exactly this rule,
        // not every override sharing the same wmClass.
        onRemove: (item, parent) => this.onRemoveHandler(override, parent),
      });
    });
  }

  onAddHandler() {
    const wmClass = this.wmClassEntry.get_text().trim();
    const wmTitle = this.wmTitleEntry.get_text().trim();

    if (!wmClass) {
      this.wmClassEntry.add_css_class("error");
      return;
    }
    this.wmClassEntry.remove_css_class("error");

    const newOverride = { wmClass, mode: "float" };
    if (wmTitle) newOverride.wmTitle = wmTitle;

    const existing = this.configMgr.windowProps.overrides;
    // forge-eryk: removeOverride is remove-ALL by structural identity (that is
    // what keeps same-class siblings safe, forge-fov0), so a duplicate row would
    // make trashing either one delete both while the other stayed on screen.
    if (hasOverride(existing, newOverride)) {
      this.wmClassEntry.add_css_class("error");
      return;
    }
    existing.push(newOverride);
    this.saveOverrides(existing);

    const itemRow = new RemoveItemRow({
      title: wmTitle || wmClass,
      subtitle: wmClass,
      // Close over the freshly-added override so this row removes exactly itself.
      onRemove: (item, parent) => this.onRemoveHandler(newOverride, parent),
    });

    const insertIndex = this.rows.findIndex(
      (row) => (row.get_subtitle() ?? "").localeCompare(wmClass) > 0
    );
    if (insertIndex === -1) {
      this.rows.push(itemRow);
      this.floatingWindowGroup.add(itemRow);
    } else {
      this.rows.splice(insertIndex, 0, itemRow);
      // Rebuild the group to maintain order (Adw.PreferencesGroup doesn't support insert)
      this.rebuildFloatingList();
    }

    this.wmClassEntry.set_text("");
    this.wmTitleEntry.set_text("");
    this.searchEntry.set_text("");
  }

  onRemoveHandler(override, parent) {
    this.floatingWindowGroup.remove(parent);
    this.rows = this.rows.filter((row) => row != parent);
    const existing = this.configMgr.windowProps.overrides;
    const modified = removeOverride(existing, override);
    this.saveOverrides(modified);
  }

  saveOverrides(modified) {
    if (modified) {
      this.configMgr.windowProps = {
        overrides: modified,
      };
      // Signal the main extension to reload floating overrides.
      //
      // forge-0w71: this was Math.floor(Date.now() / 1000). Writing an identical
      // value to a dconf-backed key emits no "changed" signal, so two edits in
      // the same second only ever notified once — and this is the ONLY channel
      // from prefs to the running extension (there is no file monitor on
      // windows.json), so the second edit never reached the live session.
      // Read-then-increment always changes, and is immune to clock jumps. The
      // gschema type is "u" (uint32), so wrap rather than overflow.
      const key = "window-overrides-reload-trigger";
      this.settings.set_uint(key, (this.settings.get_uint(key) + 1) >>> 0);
    }
  }

  onResetHandler() {
    const defaultWindowProps = this.configMgr.loadDefaultWindowConfigContents();
    const original = defaultWindowProps.overrides;
    this.saveOverrides(original);

    for (const child of this.rows) {
      this.floatingWindowGroup.remove(child);
    }

    this.rows = this.loadItemsFromConfig(original);
    for (const item of this.rows) {
      this.floatingWindowGroup.add(item);
    }

    this.searchEntry.set_text("");
  }

  rebuildFloatingList() {
    for (const row of this.rows) {
      this.floatingWindowGroup.remove(row);
    }
    for (const row of this.rows) {
      this.floatingWindowGroup.add(row);
    }
  }
}
