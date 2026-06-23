/*
 * This file is part of the Forge extension for GNOME
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

// Gnome imports
import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import Meta from "gi://Meta";
import Shell from "gi://Shell";
import St from "gi://St";

// Shared state
import { Logger } from "../shared/logger.js";

// App imports
import { createEnum } from "./enum.js";
import * as Utils from "./utils.js";
import * as Window from "./window.js";
import { MonitorManager } from "./monitor.js";
import { WorkspaceManager } from "./workspace.js";

export const NODE_TYPES = createEnum([
  "ROOT",
  "MONITOR", //Output in i3
  "CON", //Container in i3
  "WINDOW",
  "WORKSPACE",
]);

export const LAYOUT_TYPES = createEnum(["STACKED", "TABBED", "ROOT", "HSPLIT", "VSPLIT", "PRESET"]);

export const ORIENTATION_TYPES = createEnum(["NONE", "HORIZONTAL", "VERTICAL"]);

export const POSITION = createEnum(["BEFORE", "AFTER", "UNKNOWN"]);

// Tuning factor for the stacked/tabbed decoration placement (forge-u8ni): it
// divides the border+gap contribution into the width and x adjustments, and
// doubles as the flat y-offset that lifts the header strip over the bordered
// content. Empirically tuned to keep the strip aligned with the content below.
const DECORATION_ADJUST_FACTOR = 4;

/**
 * The Node data representation of the following elements in the user's display:
 *
 * Monitor,
 * Window,
 * Container (generic),
 * Workspace
 *
 */
export class Node extends GObject.Object {
  static {
    GObject.registerClass(this);
  }

  constructor(type, data) {
    super();
    // Internal properties - kept as simple instance properties rather than GObject properties
    // because _data can be heterogeneous (Meta.Window, strings, or St.Bin) and the current
    // pattern is consistent with the rest of this codebase.
    this._type = type; // see NODE_TYPES
    // _data: Meta.Window, unique id strings (Monitor,
    // Workspace or St.Bin - a representation of Container)
    this._data = data;
    this._parent = null;
    this._nodes = []; // Child elements of this node
    this.mode = Window.WINDOW_MODES.DEFAULT;
    this.percent = 0.0;
    this._rect = null;
    this.tab = null;
    this.decoration = null;
    this.app = null;
    this.pointer = null;

    if (this.isWindow()) {
      // When destroy() is called on Meta.Window, it might not be
      // available so we store it immediately
      this._initMetaWindow();
      this._actor = this._data.get_compositor_private();
      this._createWindowTab();
    }

    if (this.isCon()) {
      this._createDecoration();
    }
  }

  get windowActor() {
    return this._actor;
  }

  get actor() {
    switch (this.nodeType) {
      case NODE_TYPES.WINDOW:
        // A Meta.Window was assigned during creation
        // But obtain the Clutter.Actor
        return this._actor;
      case NODE_TYPES.CON:
      case NODE_TYPES.ROOT:
        // A St.Bin was assigned during creation
        return this.nodeValue;
      case NODE_TYPES.MONITOR:
      case NODE_TYPES.WORKSPACE:
        // A separate St.Bin was assigned on another attribute during creation
        return this.actorBin;
    }
  }

  set rect(rect) {
    this._rect = rect;
    if (!rect) return;
    switch (this.nodeType) {
      case NODE_TYPES.WINDOW:
        break;
      case NODE_TYPES.CON:
      case NODE_TYPES.MONITOR:
      case NODE_TYPES.ROOT:
      case NODE_TYPES.WORKSPACE:
        if (this.actor) {
          this.actor.set_size(rect.width, rect.height);
          this.actor.set_position(rect.x, rect.y);
        }
        break;
    }
  }

  get rect() {
    return this._rect;
  }

  get childNodes() {
    return this._nodes;
  }

  set childNodes(nodes) {
    this._nodes = nodes;
  }

  get firstChild() {
    if (this._nodes && this._nodes.length >= 1) {
      return this._nodes[0];
    }
    return null;
  }

  get level() {
    let _level = 0;
    let refNode = this.parentNode;
    while (refNode) {
      _level += 1;
      refNode = refNode.parentNode;
    }

    return _level;
  }

  /**
   * Find the index of this relative to the siblings
   */
  get index() {
    if (this.parentNode) {
      let childNodes = this.parentNode.childNodes;
      for (let i = 0; i < childNodes.length; i++) {
        if (childNodes[i] === this) {
          return i;
        }
      }
    }
    return null;
  }

  get lastChild() {
    if (this._nodes && this._nodes.length >= 1) {
      return this._nodes[this._nodes.length - 1];
    }
    return null;
  }

  get nextSibling() {
    if (this.parentNode) {
      if (this.parentNode.lastChild !== this) {
        return this.parentNode.childNodes[this.index + 1];
      }
    }
    return null;
  }

  get nodeType() {
    return this._type;
  }

  get nodeValue() {
    return this._data;
  }

  set nodeValue(value) {
    this._data = value;
  }

  get parentNode() {
    return this._parent;
  }

  set parentNode(node) {
    this._parent = node;
  }

  get previousSibling() {
    if (this.parentNode) {
      if (this.parentNode.firstChild !== this) {
        return this.parentNode.childNodes[this.index - 1];
      }
    }
    return null;
  }

  appendChild(node) {
    if (!node) return null;
    if (node.parentNode) node.parentNode.removeChild(node);
    this.childNodes.push(node);
    node.parentNode = this;
    return node;
  }

  /**
   * Checks if node is a descendant of this,
   * or a descendant of its childNodes, etc
   */
  contains(node) {
    if (!node) return false;
    let searchNode = this.getNodeByValue(node.nodeValue);
    return searchNode ? true : false;
  }

  getNodeByLayout(layout) {
    let results = this._search(layout, "LAYOUT");
    return results;
  }

  getNodeByMode(mode) {
    let results = this._search(mode, "MODE");
    return results;
  }

  getNodeByValue(value) {
    let results = this._search(value, "VALUE");
    return results && results.length >= 1 ? results[0] : null;
  }

  getNodeByType(type) {
    let results = this._search(type, "TYPE");
    return results;
  }

  /**
   * @param childNode - is a child of this
   */
  insertBefore(newNode, childNode) {
    if (!newNode) return null;
    if (newNode === childNode) return null;
    if (!childNode) {
      this.appendChild(newNode);
      return newNode;
    }
    if (childNode.parentNode !== this) return null;
    if (newNode.parentNode) newNode.parentNode.removeChild(newNode);
    let index = childNode.index;

    if (childNode.index === 0) {
      this.childNodes.unshift(newNode);
    } else if (childNode.index > 0) {
      this.childNodes.splice(index, 0, newNode);
    }
    newNode.parentNode = this;

    return newNode;
  }

  isLayout(name) {
    let layout = this.layout;
    if (!layout) return false;

    return name === layout;
  }

  isHSplit() {
    return this.isLayout(LAYOUT_TYPES.HSPLIT);
  }

  isVSplit() {
    return this.isLayout(LAYOUT_TYPES.VSPLIT);
  }

  isStacked() {
    return this.isLayout(LAYOUT_TYPES.STACKED);
  }

  isTabbed() {
    return this.isLayout(LAYOUT_TYPES.TABBED);
  }

  isStackedOrTabbed() {
    return this.isStacked() || this.isTabbed();
  }

  isType(name) {
    const type = this.nodeType;
    if (!type) return false;

    return name === type;
  }

  isWindow() {
    return this.isType(NODE_TYPES.WINDOW);
  }

  isCon() {
    return this.isType(NODE_TYPES.CON);
  }

  isMonitor() {
    return this.isType(NODE_TYPES.MONITOR);
  }

  isWorkspace() {
    return this.isType(NODE_TYPES.WORKSPACE);
  }

  isRoot() {
    return this.isType(NODE_TYPES.ROOT);
  }

  isMode(name) {
    const mode = this.mode;
    if (!name) return false;

    return name === mode;
  }

  isFloat() {
    return this.isMode(Window.WINDOW_MODES.FLOAT);
  }

  isTile() {
    return this.isMode(Window.WINDOW_MODES.TILE);
  }

  isGrabTile() {
    return this.isMode(Window.WINDOW_MODES.GRAB_TILE);
  }

  removeChild(node) {
    if (node.isStackedOrTabbed() && node.decoration) {
      node.decoration.hide();
      node.decoration.destroy_all_children();
      node.decoration.destroy();
      node.decoration = null;
    }

    // Bug #57 (forge-37r): a removed CON may own a header tab in its parent's
    // decoration — tear it down so it does not dangle. WINDOW-node tab teardown
    // is NOT done here: removeChild is also the reparent-detach primitive
    // (appendChild/insertBefore), where a moved window must keep its tab. The
    // window-tab leak on genuine removal (forge-wrot) is handled in removeNode.
    if (node.isCon() && node.tab) {
      node._destroyTab();
    }

    // Resolve the child by identity (the index getter), not the value-based
    // contains(): split() leaves a stale original-node reference whose nodeValue
    // still matches a fresh sibling, so contains() returns true while index is
    // null. splice(null, 1) coerces to splice(0, 1) and evicts the WRONG child
    // (forge-mo27). The index getter is the single source of truth for "is this
    // a direct child of its own parent", and is null for a detached/stale node.
    let refNode;
    const childIndex = node.index;
    if (childIndex !== null) {
      refNode = node.parentNode.childNodes.splice(childIndex, 1);
      // Clear the parent reference on the removed node
      node.parentNode = null;
    }
    if (!refNode) {
      throw `NodeNotFound ${node}`;
    }
    return refNode;
  }

  /**
   * Backend for getNodeBy[attribute]. It is similar to DOM.getElementBy functions
   */
  _search(term, criteria) {
    let results = [];
    let searchFn = (candidate) => {
      if (criteria) {
        switch (criteria) {
          case "VALUE":
            if (candidate.nodeValue === term) {
              results.push(candidate);
            }
            break;
          case "TYPE":
            if (candidate.nodeType === term) {
              results.push(candidate);
            }
            break;
          case "MODE":
            if (candidate.mode === term) {
              results.push(candidate);
            }
            break;
          case "LAYOUT":
            if (candidate.layout && candidate.layout === term) {
              results.push(candidate);
            }
        }
      } else {
        if (candidate === term) {
          results.push(candidate);
        }
      }
    };

    this._walk(searchFn, this._traverseBreadthFirst);
    return results;
  }

  // start walking from root and all child nodes
  _traverseBreadthFirst(callback) {
    let queue = new Queue();
    queue.enqueue(this);

    let currentNode = queue.dequeue();

    while (currentNode) {
      for (let i = 0, length = currentNode.childNodes.length; i < length; i++) {
        queue.enqueue(currentNode.childNodes[i]);
      }

      callback(currentNode);
      currentNode = queue.dequeue();
    }
  }

  // start walking from bottom to root
  _traverseDepthFirst(callback) {
    let recurse = (currentNode) => {
      for (let i = 0, length = currentNode.childNodes.length; i < length; i++) {
        recurse(currentNode.childNodes[i]);
      }

      callback(currentNode);
    };
    recurse(this);
  }

  _walk(callback, traversal) {
    traversal.call(this, callback);
  }

  _initMetaWindow() {
    if (this.isWindow()) {
      let windowTracker = Shell.WindowTracker.get_default();
      let metaWin = this.nodeValue;
      let app = windowTracker.get_window_app(metaWin);
      this.app = app;
    }
  }

  /**
   * forge-2uc0: Shell.WindowTracker.get_window_app() can return null at map time
   * for apps that report wm_class late (Anki, Opera, many Flatpaks). this.app is
   * snapshotted once in _initMetaWindow at construction, so such a window never
   * gets a tab. Re-run the snapshot then (re)build the tab when the class lands —
   * _createWindowTab early-returns when this.tab already exists, so this only
   * fills the gap left by an earlier null app.
   */
  refreshApp() {
    this._initMetaWindow();
    this._createWindowTab();
  }

  /**
   * Shared header-tab scaffold (icon + title in a styled box). The title button
   * stays at child index 1 so Node.render() can refresh it uniformly for window
   * and CON (forge-37r) tabs. Callers append any extra controls (e.g. a close
   * button) and wire their own click handlers.
   */
  _buildTabBase(app, labelText) {
    let tabContents = new St.BoxLayout({
      style_class: "window-tabbed-tab",
      x_expand: true,
    });
    let iconBin = new St.Button({ style_class: "window-tabbed-tab-icon" });
    iconBin.child = app.create_icon_texture(24 * Utils.dpi());
    let titleButton = new St.Button({ x_expand: true, label: `${labelText}` });
    tabContents.add_child(iconBin);
    tabContents.add_child(titleButton);
    return { tabContents, iconBin, titleButton };
  }

  _createWindowTab() {
    // forge-v4u0: WindowTracker.get_window_app() can return null; skip the tab
    // (and its app.create_icon_texture() call) like _ensureConTab guards on !rep.app.
    if (this.tab || !this.isWindow() || !this.app) return;

    let metaWin = this.nodeValue;
    let { tabContents, iconBin, titleButton } = this._buildTabBase(this.app, this._getTitle());
    let closeButton = new St.Button({
      style_class: "window-tabbed-tab-close",
      child: new St.Icon({ icon_name: "window-close-symbolic" }),
    });
    tabContents.add_child(closeButton);

    let clickFn = () => {
      this.parentNode.childNodes.forEach((c) => {
        if (c.tab) {
          c.tab.remove_style_class_name("window-tabbed-tab-active");
          c.render();
        }
      });
      tabContents.add_style_class_name("window-tabbed-tab-active");
      metaWin.activate(global.display.get_current_time());
    };

    let closeFn = () => {
      metaWin.delete(global.get_current_time());
    };

    let middleClickCloseFn = (_, event) => {
      if (event.get_button() === Clutter.BUTTON_MIDDLE) {
        metaWin.delete(global.get_current_time());
      }
    };

    iconBin.connect("clicked", clickFn);
    iconBin.connect("button-release-event", middleClickCloseFn);
    titleButton.connect("clicked", clickFn);
    titleButton.connect("button-release-event", middleClickCloseFn);
    closeButton.connect("clicked", closeFn);
    closeButton.connect("button-release-event", middleClickCloseFn);

    if (metaWin === global.display.get_focus_window()) {
      tabContents.add_style_class_name("window-tabbed-tab-active");
    }
    this.tab = tabContents;
  }

  /**
   * Bug #57 (forge-37r): build (or rebuild) a header tab for a CON child of a
   * tabbed parent so the nested split renders as a single i3-style tab item.
   * The representative (first descendant) window supplies the icon/title and is
   * the activation target; clicking raises the whole sub-tree so its split shows
   * above the other tabs. Rebuilt when the representative changes (windows
   * opened/closed/moved); torn down when the CON has no windows.
   */
  _ensureConTab() {
    if (!this.isCon()) return;
    let rep = this.getNodeByType(NODE_TYPES.WINDOW)[0];
    if (!rep || !rep.app) {
      this._destroyTab();
      this._tabRep = null;
      return;
    }
    if (this.tab && this._tabRep === rep) return;
    this._destroyTab();
    this._tabRep = rep;

    let { tabContents, iconBin, titleButton } = this._buildTabBase(rep.app, this._getTitle());

    let clickFn = () => {
      this.parentNode?.childNodes.forEach((c) => {
        if (c.tab) {
          c.tab.remove_style_class_name("window-tabbed-tab-active");
          c.render();
        }
      });
      tabContents.add_style_class_name("window-tabbed-tab-active");
      // Resolve the representative live (the captured one may have since closed).
      let windows = this.getNodeByType(NODE_TYPES.WINDOW);
      windows.forEach((w) => w.nodeValue?.raise());
      windows[0]?.nodeValue?.activate(global.display.get_current_time());
    };

    iconBin.connect("clicked", clickFn);
    titleButton.connect("clicked", clickFn);

    this.tab = tabContents;
  }

  _destroyTab() {
    if (!this.tab) return;
    // The tab actor may already have been destroyed via the parent decoration's
    // destroy_all_children() (removeChild) or a prior _destroyTab. Forge never
    // set the old `_destroyed` flag this guarded on, so it was vacuous — touching
    // a finalized Clutter actor (get_parent/destroy) throws (forge-5r0j). Wrap in
    // try/catch and null the ref either way so the op is idempotent and the next
    // render rebuilds a fresh tab.
    try {
      let parent = this.tab.get_parent ? this.tab.get_parent() : null;
      if (parent) parent.remove_child(this.tab);
      if (this.tab.destroy) this.tab.destroy();
    } catch (e) {
      Logger.warn(`_destroyTab: tab actor already finalized: ${e}`);
    }
    this.tab = null;
  }

  _createDecoration() {
    if (this.decoration) return;
    let decoration = new St.BoxLayout();
    // Default to a horizontal row of tabs (tabbed layout); processStacked flips
    // this to a vertical column per render. St.BoxLayout defaults to HORIZONTAL,
    // but set it explicitly rather than relying on the default.
    decoration.orientation = Clutter.Orientation.HORIZONTAL;
    decoration.type = "forge-deco";
    decoration.parentNode = this;
    let globalWinGrp = global.window_group;
    decoration.style_class = "window-tabbed-bg";

    if (!globalWinGrp.contains(decoration)) {
      globalWinGrp.add_child(decoration);
    }

    decoration.hide();
    this.decoration = decoration;
  }

  /**
   * Tear down this node's decoration St.BoxLayout and null the reference so the
   * next render rebuilds a fresh one via _createDecoration. Used by the
   * processStacked/processTabbed self-heal catch blocks: nulling alone stranded
   * the old header in window_group (forge-ogmd). Wrapped so a second throw on an
   * already-finalized actor can't escape the render loop.
   */
  _destroyDecoration() {
    if (!this.decoration) return;
    try {
      const parent = this.decoration.get_parent ? this.decoration.get_parent() : null;
      if (parent) parent.remove_child(this.decoration);
      if (this.decoration.destroy) this.decoration.destroy();
    } catch (e) {
      Logger.warn(`_destroyDecoration: decoration actor already finalized: ${e}`);
    }
    this.decoration = null;
  }

  _getTitle() {
    if (this.isWindow() && this.nodeValue) {
      return this.nodeValue.title ? this.nodeValue.title : this.app?.get_name();
    }
    // Bug #57 (forge-37r): a CON header tab borrows the title of its representative
    // (first descendant) window so a nested split reads as one collapsible item.
    if (this.isCon()) {
      let rep = this.getNodeByType(NODE_TYPES.WINDOW)[0];
      if (rep && rep.nodeValue) {
        return rep.nodeValue.title ? rep.nodeValue.title : rep.app?.get_name();
      }
    }
    return null;
  }

  render() {
    // Always update the title for the tab
    if (this.tab !== null && this.tab !== undefined) {
      let titleLabel = this.tab.get_child_at_index(1);
      let title = this._getTitle();
      // title can be null for a CON whose representative window is mid-removal.
      if (titleLabel && title != null) titleLabel.label = title;
    }
  }

  set float(value) {
    if (this.isWindow()) {
      let metaWindow = this.nodeValue;
      let floatAlwaysOnTop = this.settings.get_boolean("float-always-on-top-enabled");
      if (value) {
        this.mode = Window.WINDOW_MODES.FLOAT;
        // Bug #289 fix: Don't apply always-on-top to fullscreen windows
        const isFullscreen = metaWindow.is_fullscreen();
        // Only pin floats when the user opted into always-on-top. Dialogs are
        // kept above the tiled grid by raise-on-focus (WindowManager focus
        // handler), not a global make_above pin — a permanent pin used to strand
        // a popup above every other float so clicking a sibling never raised it.
        if (!metaWindow.is_above() && floatAlwaysOnTop && !isFullscreen) {
          metaWindow.make_above();
          this._forgeSetAbove = true; // Track that Forge set this
        }
      } else {
        this.mode = Window.WINDOW_MODES.TILE;
        // Only remove always-on-top if Forge was the one who set it
        if (metaWindow.is_above() && this._forgeSetAbove) {
          metaWindow.unmake_above();
          this._forgeSetAbove = false;
        }
      }
    }
  }

  set tile(value) {
    this.float = !value;
  }

  resetLayoutSingleChild() {
    if (this.isStackedOrTabbed() && this.singleOrNoChild()) {
      this.layout = LAYOUT_TYPES.HSPLIT;
    }
  }

  singleOrNoChild() {
    return this.childNodes.length <= 1;
  }
}

/**
 * An implementation of Queue using arrays
 */
export class Queue extends GObject.Object {
  static {
    GObject.registerClass(this);
  }

  constructor() {
    super();
    this._elements = [];
  }

  get length() {
    return this._elements.length;
  }

  enqueue(item) {
    this._elements.push(item);
  }

  dequeue() {
    return this._elements.shift();
  }
}

export class Tree extends Node {
  static {
    GObject.registerClass(this);
  }

  /** @param {Window.WindowManager} extWm */
  constructor(extWm) {
    let rootBin = new St.Bin();
    super(NODE_TYPES.ROOT, rootBin);
    this._extWm = extWm;
    this.settings = this.extWm.ext.settings;
    this.layout = LAYOUT_TYPES.ROOT;
    if (!global.window_group.contains(rootBin)) global.window_group.add_child(rootBin);

    // Create monitor manager for monitor-related operations
    this._monitorManager = new MonitorManager(this, extWm);

    // Create workspace manager for workspace-related operations
    this._workspaceManager = new WorkspaceManager(this, extWm);

    this._initWorkspaces();
  }

  /** @type {MonitorManager} */
  get monitorManager() {
    return this._monitorManager;
  }

  /** @type {WorkspaceManager} */
  get workspaceManager() {
    return this._workspaceManager;
  }

  /** @type {Window.WindowManager} */
  get extWm() {
    return this._extWm;
  }

  /**
   * Handles new and existing workspaces in the tree
   */
  _initWorkspaces() {
    let wsManager = global.display.get_workspace_manager();
    let workspaces = wsManager.get_n_workspaces();
    for (let i = 0; i < workspaces; i++) {
      this.addWorkspace(i);
    }
  }

  /**
   * Add monitor nodes for a workspace.
   * Delegates to MonitorManager.
   * @param {number} wsIndex - Workspace index
   */
  addMonitor(wsIndex) {
    this._monitorManager.addMonitor(wsIndex);
  }

  /**
   * Add a workspace to the tree structure.
   * Delegates to WorkspaceManager.
   * @param {number} wsIndex - Workspace index
   * @returns {boolean} True if workspace was added
   */
  addWorkspace(wsIndex) {
    return this._workspaceManager.addWorkspace(wsIndex);
  }

  /**
   * Remove a workspace from the tree structure.
   * Delegates to WorkspaceManager.
   * @param {number} wsIndex - Workspace index
   * @returns {boolean} True if workspace was removed
   */
  removeWorkspace(wsIndex) {
    return this._workspaceManager.removeWorkspace(wsIndex);
  }

  get nodeWorkpaces() {
    let nodeWorkspaces = this.getNodeByType(NODE_TYPES.WORKSPACE);
    return nodeWorkspaces;
  }

  get nodeWindows() {
    let nodeWindows = this.getNodeByType(NODE_TYPES.WINDOW);
    return nodeWindows;
  }

  /**
   * Reloads the tree structure. This is an expensive operation.
   * Useful when using dynamic workspaces in GNOME-shell.
   *
   * Note: Caller is responsible for tracking current windows and rendering
   * after this method completes.
   */
  reload() {
    Utils._disableDecorations();
    // forge-h6jc: tear down the existing generation of workspace/monitor
    // scaffold bins before dropping the nodes, otherwise reload() orphans them
    // in global.window_group and leaks an St.Bin per workspace+monitor.
    this._removeScaffoldBins();
    // Empty out the root children nodes
    this.childNodes.length = 0;
    this.attachNode = undefined;
    // Re-initialize the workspaces and monitors
    this._initWorkspaces();
  }

  /**
   * forge-h6jc: remove the current workspace/monitor scaffold bins from
   * global.window_group. The root bin is intentionally left in place so it can
   * be reused; destroy() handles the root bin on teardown. Mirrors the
   * contains()-guarded remove_child used in WorkspaceManager.removeWorkspace.
   */
  _removeScaffoldBins() {
    const nodeBins = [
      ...this.getNodeByType(NODE_TYPES.WORKSPACE),
      ...this.getNodeByType(NODE_TYPES.MONITOR),
    ];
    for (const node of nodeBins) {
      const bin = node.actorBin;
      if (bin && global.window_group.contains(bin)) global.window_group.remove_child(bin);
    }
  }

  /**
   * forge-h6jc: full scaffold teardown for disable(). Removes every
   * workspace/monitor actorBin and the root bin from global.window_group so no
   * St.Bins are leaked when the tree is dropped.
   */
  destroy() {
    this._removeScaffoldBins();
    const rootBin = this.nodeValue;
    if (rootBin && global.window_group.contains(rootBin)) global.window_group.remove_child(rootBin);
  }

  /**
   * forge-bqa: capture the STACKED/TABBED groupings before a destructive
   * reload() so they can be re-applied afterwards. node.layout lives only in
   * memory, so reload() (which clears the tree) otherwise loses every stack/tab
   * grouping and the windows come back as a flat split. Windows are keyed by
   * their live Meta.Window object, which survives reload().
   *
   * forge-4y80: groups whose children include a nested sub-split CON (the Bug
   * #57 shape) are captured as a recursive descriptor tree rather than skipped,
   * so the nested structure survives the reload instead of being flattened.
   * Only the OUTERMOST stacked/tabbed group is captured at top level; nested
   * stacked/tabbed cons are folded into their ancestor's descriptor.
   */
  snapshotLayoutGroups() {
    const groups = [];
    for (const layout of [LAYOUT_TYPES.STACKED, LAYOUT_TYPES.TABBED]) {
      for (const con of this.getNodeByLayout(layout)) {
        if (con.childNodes.length < 2) continue;
        if (this._hasStackedOrTabbedAncestor(con)) continue;
        groups.push(this._snapshotNode(con));
      }
    }
    return groups;
  }

  /** Recursive descriptor: WINDOW leaves keyed by Meta.Window, CONs by layout. */
  _snapshotNode(node) {
    if (node.isWindow()) {
      return { window: node.nodeValue };
    }
    return {
      layout: node.layout,
      lastTabFocus: node.lastTabFocus ?? null,
      children: node.childNodes.map((child) => this._snapshotNode(child)),
    };
  }

  _hasStackedOrTabbedAncestor(node) {
    let p = node.parentNode;
    while (p && p.nodeType === NODE_TYPES.CON) {
      if (p.isStackedOrTabbed()) return true;
      p = p.parentNode;
    }
    return false;
  }

  /**
   * forge-bqa / forge-4y80: re-apply the groupings captured by
   * snapshotLayoutGroups() after the tree has been rebuilt with the windows
   * flat under their monitor. For each group, resolve the surviving leaf
   * windows; when at least two landed back under one common parent, rebuild the
   * captured (possibly nested) sub-tree in place at the cohort's original
   * position.
   *
   * Rebuilt CONs get a fresh St.Bin (the original Bin died with the old tree, so
   * CONs cannot be matched by identity — only WINDOW leaves can). Percents reset
   * to equal split per level; restoring custom inner sizes is out of scope.
   */
  restoreLayoutGroups(snapshot) {
    if (!snapshot || snapshot.length === 0) return;
    for (const descriptor of snapshot) {
      const winNodes = this._descriptorWindows(descriptor)
        .map((win) => this.findNode(win))
        .filter((node) => node);
      if (winNodes.length < 2) continue;
      // Only regroup windows that all landed back under the same parent; a
      // scattered group (windows moved monitors, or some closed) is skipped.
      const parent = winNodes[0].parentNode;
      const cohort = winNodes.filter((node) => node.parentNode === parent);
      if (cohort.length < 2) continue;

      // insertIndex is the cohort's first position in the original flat parent.
      // _rebuildGroup detaches the cohort windows (via appendChild) as it builds,
      // and every node before insertIndex is a non-cohort sibling that keeps its
      // place — so splicing the rebuilt CON in afterwards lands it correctly.
      const insertIndex = Math.min(...cohort.map((node) => node.index));
      const cohortSet = new Set(cohort);
      const rebuilt = this._rebuildGroup(descriptor, cohortSet);
      // A degenerate group that collapsed to a single surviving window needs no
      // wrapping CON; leave it where the reload placed it.
      if (!rebuilt || rebuilt.isWindow()) continue;

      rebuilt.parentNode = parent;
      parent.childNodes.splice(insertIndex, 0, rebuilt);
      this.resetSiblingPercent(parent);
    }
  }

  /** Flatten a descriptor to its leaf Meta.Window objects. */
  _descriptorWindows(descriptor) {
    if ("window" in descriptor) return [descriptor.window];
    return descriptor.children.flatMap((child) => this._descriptorWindows(child));
  }

  /**
   * Rebuild a descriptor sub-tree from surviving window nodes. Window leaves not
   * in `cohortSet` (closed or scattered to another parent) are dropped. A CON
   * with fewer than two surviving children collapses to that child (or null), so
   * the rebuilt tree never carries degenerate single-child containers.
   */
  _rebuildGroup(descriptor, cohortSet) {
    if ("window" in descriptor) {
      const node = this.findNode(descriptor.window);
      return node && cohortSet.has(node) ? node : null;
    }
    const children = descriptor.children
      .map((child) => this._rebuildGroup(child, cohortSet))
      .filter((node) => node);
    if (children.length === 0) return null;
    if (children.length === 1) return children[0];

    const con = new Node(NODE_TYPES.CON, new St.Bin());
    con.settings = this.settings;
    con.layout = descriptor.layout;
    // appendChild detaches each child from its current parent first.
    children.forEach((child) => con.appendChild(child));
    if (descriptor.layout === LAYOUT_TYPES.TABBED) {
      // The snapshotted focus may have been a window that did not survive the
      // reload; fall back to the first survivor so it never dangles.
      const focusSurvived = children.some((node) => node.nodeValue === descriptor.lastTabFocus);
      con.lastTabFocus = focusSurvived ? descriptor.lastTabFocus : children[0].nodeValue;
    }
    this.resetSiblingPercent(con);
    return con;
  }

  /**
   * Creates a new Node and attaches it to a parent toData.
   * Parent can be MONITOR or CON types only.
   */
  createNode(parentObj, type, value, mode = Window.WINDOW_MODES.TILE) {
    let parentNode = this.findNode(parentObj);
    let child;

    if (parentNode) {
      child = new Node(type, value);
      child.settings = this.settings;

      if (child.isWindow()) child.mode = mode;

      // Append after a window
      if (parentNode.isWindow()) {
        const grandParentNode = parentNode.parentNode;
        grandParentNode.insertBefore(child, parentNode.nextSibling);
        Logger.debug(
          `Parent is a window, attaching to this window's parent ${grandParentNode.nodeType}`
        );
      } else {
        // Append as the last item of the container
        parentNode.appendChild(child);
      }
    }
    return child;
  }

  /**
   * Finds any Node in the tree using data
   * Data types can be in the form of Meta.Window or unique id strings
   * for Workspace, Monitor and Container
   *
   * Workspace id strings takes the form `ws{n}`.
   * Monitor id strings takes the form `mo{m}ws{n}`
   * Container id strings takes the form `mo{m}ws{n}c{x}`
   *
   */
  findNode(data) {
    let searchNode = this.getNodeByValue(data);
    return searchNode;
  }

  /**
   * Find the NodeWindow using the Meta.WindowActor
   */
  findNodeByActor(windowActor) {
    let searchNode;
    let criteriaMatchFn = (node) => {
      if (node.isWindow() && node.actor === windowActor) {
        searchNode = node;
      }
    };

    this._walk(criteriaMatchFn, this._traverseDepthFirst);

    return searchNode;
  }

  /**
   * Select the appropriate focus window from a container based on direction
   * @param {Node} container - The container node
   * @param {boolean} previous - Whether navigating to previous (before) position
   * @returns {Node|null} The selected window node
   */
  _selectFocusWindow(container, previous) {
    const windows = container
      .getNodeByType(NODE_TYPES.WINDOW)
      .filter((w) => w.isTile() && !w.nodeValue.minimized);

    if (windows.length === 0) return null;
    // Stacked: focus the top of the stack — but lastChild can be a nested CON
    // (or a minimized/floating window) whose nodeValue has no raise(); pick the
    // last eligible WINDOW in the subtree instead.
    if (container.layout === LAYOUT_TYPES.STACKED) return windows[windows.length - 1];
    if (windows.length > 1) {
      return previous ? windows[windows.length - 1] : windows[0];
    }
    return windows[0];
  }

  /**
   * Focuses on the next node, if metaWindow and tiled, raise it
   */
  focus(node, direction) {
    if (!node) return null;
    let next = this.next(node, direction);

    if (!next) return null;

    let type = next.nodeType;
    let position = Utils.positionFromDirection(direction);
    const previous = position === POSITION.BEFORE;

    switch (type) {
      case NODE_TYPES.WINDOW:
        break;
      case NODE_TYPES.CON:
        next = this._selectFocusWindow(next, previous);
        break;
      case NODE_TYPES.MONITOR:
        if (next.layout === LAYOUT_TYPES.STACKED) {
          next = next.lastChild;
        } else {
          next = previous ? next.lastChild : next.firstChild;
        }

        if (next && next.nodeType === NODE_TYPES.CON) {
          next = this._selectFocusWindow(next, previous);
        }
        break;
    }

    return this._activateWindowNode(next, direction);
  }

  /**
   * Raise/focus a resolved target WINDOW node and apply the focus-follow pointer
   * policy. Shared by directional focus() and the cyclic focusSibling() so both
   * paths get identical activation + Wayland stacking behavior (forge-zrl). The
   * optional `direction` is passed only by the directional caller, which retries
   * past a minimized target; cyclic callers pass undefined and only ever resolve
   * to non-minimized windows.
   */
  _activateWindowNode(next, direction) {
    if (!next) return null;

    let metaWindow = next.nodeValue;
    if (!metaWindow) return null;
    const previousMetaWindow = this.extWm.focusMetaWindow;
    if (metaWindow.minimized) {
      // A direction of 0 is valid (MotionDirection.UP), so test for presence,
      // not truthiness. Cyclic callers pass undefined and bail here.
      next = direction !== undefined ? this.focus(next, direction) : null;
    } else {
      metaWindow.raise();
      metaWindow.focus(global.display.get_current_time());
      metaWindow.activate(global.display.get_current_time());

      // Bug #416 fix: Ensure proper stacking on Wayland (above desktop layer)
      if (Meta.is_wayland_compositor && Meta.is_wayland_compositor()) {
        try {
          const wasAbove = metaWindow.is_above();
          if (!wasAbove) {
            // Forge's own transient stacking pin. Suppress the notify::above so
            // it isn't read as the user toggling "Always on Top", and flag the
            // window so isFloatingExempt does not float-eject it while pinned
            // (forge-ph7f): rapid focus used to leak pins through a single
            // shared timer, stranding earlier windows above where processFloats
            // ejected them from the grid and they overlapped.
            this.extWm._withSuppressedAboveHandler(() => metaWindow.make_above());
            metaWindow._forgeTransientAbove = true;
            // Per-window timer keyed on the MetaWindow: each focused window
            // unpins on its own 50ms schedule, so a fast focus burst can no
            // longer cancel an earlier window's unpin.
            if (metaWindow._forgeStackTimeoutId) {
              GLib.Source.remove(metaWindow._forgeStackTimeoutId);
            }
            metaWindow._forgeStackTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
              metaWindow._forgeStackTimeoutId = 0;
              try {
                // Never undo a pin the user/Forge genuinely owns: an always-on-top
                // float (_forgeSetAbove) or a fullscreen-demoted float.
                if (
                  Utils.isWindowAlive(metaWindow) &&
                  metaWindow._forgeTransientAbove &&
                  !next._forgeSetAbove &&
                  !next._aboveDemotedForFullscreen
                ) {
                  this.extWm._withSuppressedAboveHandler(() => metaWindow.unmake_above());
                }
              } catch (e) {
                // Window may have been destroyed
              } finally {
                metaWindow._forgeTransientAbove = false;
              }
              return false;
            });
          }
        } catch (e) {
          Logger.warn(`Failed to adjust Wayland stacking: ${e}`);
        }
      }

      const monitorArea = Utils.getWorkAreaSafe(metaWindow);
      const ptr = this.extWm.getPointer();
      const pointerInside = monitorArea
        ? Utils.rectContainsPoint(monitorArea, [ptr[0], ptr[1]])
        : false;
      const monitorChanged =
        !!previousMetaWindow &&
        previousMetaWindow.get_monitor &&
        previousMetaWindow.get_monitor() !== metaWindow.get_monitor();

      if (this.settings.get_boolean("move-pointer-focus-enabled")) {
        this.extWm.movePointerWith(next);
      } else if (!pointerInside) {
        this.extWm.movePointerWith(next, { force: monitorChanged });
      }
    }
    return next;
  }

  /**
   * Resolve the cyclic neighbour of `node` among its immediate tiled siblings
   * (i3 "focus/move next|prev"), wrapping around. `offset` is +1 (next) or -1
   * (prev). A CON sibling resolves to one of its tiled windows. Returns a WINDOW
   * node, or null when `node` is floating/has no parent or is the only tiled
   * sibling. Shared by focusSibling()/swapSibling() so both cycle identically.
   */
  _cyclicSiblingWindow(node, offset) {
    if (!node || !node.parentNode) return null;
    const siblings = this.getTiledChildren(node.parentNode.childNodes);
    if (siblings.length <= 1) return null;
    const idx = siblings.indexOf(node);
    if (idx < 0) return null;
    let target = siblings[(idx + offset + siblings.length) % siblings.length];
    if (target && target.isCon()) target = this._selectFocusWindow(target, offset < 0);
    return target && target !== node ? target : null;
  }

  /**
   * Cyclically focus the next/previous tiled sibling, wrapping around (forge-zrl).
   * @param {Node} node - the currently focused window node
   * @param {number} offset - +1 for next, -1 for previous
   */
  focusSibling(node, offset) {
    return this._activateWindowNode(this._cyclicSiblingWindow(node, offset), undefined);
  }

  /**
   * Cyclically swap with the next/previous tiled sibling, wrapping around
   * (forge-zrl). Returns the moved node, or null when there is no valid target.
   * @param {Node} node - the currently focused window node
   * @param {number} offset - +1 for next, -1 for previous
   */
  swapSibling(node, offset) {
    const target = this._cyclicSiblingWindow(node, offset);
    if (!target) return null;
    this.swapPairs(node, target);
    return node;
  }

  /**
   * Obtains the non-floating, non-minimized list of nodes
   * Useful for calculating the rect areas
   */
  getTiledChildren(items) {
    let filterFn = (node) => {
      if (node.isWindow()) {
        let floating = node.isFloat();
        let grabTiling = node.isGrabTile();
        // A Node[Window]._data is a Meta.Window
        if (!node.nodeValue.minimized && !(floating || grabTiling)) {
          return true;
        }
      }
      // handle split containers
      if (node.isCon()) {
        return this.getTiledChildren(node.childNodes).length > 0;
      }
      return false;
    };

    return items ? items.filter(filterFn) : [];
  }

  /**
   * Move a given node into a direction.
   * Skips operation for floating or minimized windows.
   */
  move(node, direction) {
    // Skip move for floating or minimized windows
    if (!node) return false;
    if (node.isFloat()) {
      Logger.debug("Skipping move for floating window");
      return false;
    }
    if (node.isWindow() && node.nodeValue && node.nodeValue.minimized) {
      Logger.debug("Skipping move for minimized window");
      return false;
    }

    let next = this.next(node, direction);
    let position = Utils.positionFromDirection(direction);

    // forge-s7ri: an edge-wrap or same-monitor fallback must keep the window on
    // its OWN monitor. extWm.currentMonWsNode is derived from get_current_monitor()
    // (the monitor under the POINTER), which teleports the window when the pointer
    // rests on a different monitor than the focused node. Resolve the node's own
    // monitor from the tree instead.
    const ownMonNode = this.findAncestorMonitor(node);

    if (!next || next === -1) {
      if (next === -1) {
        // Handle edge of monitor - wrap within the node's own monitor workspace
        if (ownMonNode) {
          if (position === POSITION.AFTER) {
            ownMonNode.appendChild(node);
          } else {
            // Prepend: insert before the first child of the monitor
            ownMonNode.insertBefore(node, ownMonNode.firstChild);
          }
          return true;
        }
      }
      return false;
    }

    let parentNode = node.parentNode;
    let parentTarget;

    switch (next.nodeType) {
      case NODE_TYPES.WINDOW:
        // If same parent, swap
        if (next === node.previousSibling || next === node.nextSibling) {
          parentTarget = next.parentNode;
          this.swapPairs(node, next);
          if (this.settings.get_boolean("move-pointer-focus-enabled")) {
            this.extWm.movePointerWith(node);
          }
          // do not reset percent when swapped
          return true;
        } else {
          parentTarget = next.parentNode;
          if (parentTarget) {
            if (position === POSITION.AFTER) {
              parentTarget.insertBefore(node, next);
            } else {
              parentTarget.insertBefore(node, next.nextSibling);
            }
          }
        }
        break;
      case NODE_TYPES.CON:
        parentTarget = next;

        if (next.isStacked()) {
          next.appendChild(node);
        } else {
          if (position === POSITION.AFTER) {
            next.insertBefore(node, next.firstChild);
          } else {
            next.appendChild(node);
          }
        }
        break;
      case NODE_TYPES.MONITOR:
        parentTarget = next;

        // forge-s7ri: edge test and fallback both keyed on the node's own monitor
        // (ownMonNode), not the pointer monitor. The cross-monitor move below
        // still targets `next` (the real adjacent monitor).
        if (
          !next.contains(node) &&
          ownMonNode &&
          (node === ownMonNode.firstChild || node === ownMonNode.lastChild)
        ) {
          let targetMonitor = Utils.monitorIndex(next.nodeValue);
          let targetMonRect = this.extWm.rectForMonitor(node, targetMonitor);
          if (!targetMonRect) return false;
          // forge-e3k1: resolve the work-area and perform the actual window move
          // BEFORE mutating the tree, so a finalized MetaWindow throwing here
          // leaves the node on its original monitor with intact percents (the
          // reparent commits only once the geometry move has succeeded).
          let workArea = node.nodeValue.get_work_area_for_monitor(targetMonitor);
          this.extWm.move(node.nodeValue, targetMonRect, workArea);
          if (position === POSITION.AFTER) {
            next.insertBefore(node, next.firstChild);
          } else {
            next.appendChild(node);
          }
          this.extWm.movePointerWith(node);
        } else if (ownMonNode) {
          if (position === POSITION.AFTER) {
            ownMonNode.appendChild(node);
          } else {
            ownMonNode.insertBefore(node, ownMonNode.firstChild);
          }
        }
        break;
      default:
        break;
    }
    this.resetSiblingPercent(parentNode);
    this.resetSiblingPercent(parentTarget);
    parentNode.resetLayoutSingleChild();
    return true;
  }

  /**
   * Give the next sibling/parent/descendant on the tree based
   * on a given Meta.MotionDirection
   *
   * @param {Node} node
   * @param {Meta.MotionDirection} direction
   *
   * Credits: borrowed logic from tree.c of i3
   */
  next(node, direction) {
    if (!node) return null;
    let orientation = Utils.orientationFromDirection(direction);
    let position = Utils.positionFromDirection(direction);
    let previous = position === POSITION.BEFORE;

    const type = node.nodeType;

    switch (type) {
      case NODE_TYPES.ROOT:
        // Root is the top of the tree
        if (node.childNodes.length > 1) {
          if (previous) {
            return node.firstChild;
          } else {
            return node.lastChild;
          }
        } else {
          return node.firstChild;
        }
      case NODE_TYPES.WORKSPACE:
        // Let gnome-shell handle this?
        break;
      case NODE_TYPES.MONITOR:
        // Find the next monitor
        const nodeWindow = this.findFirstNodeWindowFrom(node);
        return this.nextMonitor(nodeWindow, position, orientation);
    }

    while (node && node.nodeType !== NODE_TYPES.WORKSPACE) {
      if (node.nodeType === NODE_TYPES.MONITOR) {
        return this.next(node, direction);
      }
      const parentNode = node.parentNode;
      // A detached/unrooted node (concurrent removal, malformed tree) can reach
      // the parent-walk without a WORKSPACE ancestor; reading parentNode.layout
      // would null-deref (forge-zyx3). Bail with null — every caller guards
      // `if (!next)`.
      if (!parentNode) return null;
      const parentOrientation = Utils.orientationFromLayout(parentNode.layout);

      if (parentNode.childNodes.length > 1 && orientation === parentOrientation) {
        const next = previous ? node.previousSibling : node.nextSibling;
        if (next) {
          return next;
        }
      }
      node = node.parentNode;
    }
    return null;
  }

  nextMonitor(nodeWindow, position, orientation) {
    if (!nodeWindow || !nodeWindow.nodeValue) return null;
    // Use the built in logic to determine adjacent monitors
    let monitorNode = null;
    let monitorDirection = Utils.directionFrom(position, orientation);
    let targetMonitor = -1;
    let currentMonitor = nodeWindow.nodeValue.get_monitor();
    targetMonitor = global.display.get_monitor_neighbor_index(currentMonitor, monitorDirection);
    // Bug #379 (forge-2zj): Mutter's neighbor lookup can return -1 for a monitor
    // that is geometrically adjacent (notably vertically-stacked monitors). Fall
    // back to a geometry-based neighbor before treating -1 as a true boundary.
    if (targetMonitor < 0) {
      targetMonitor = this._neighborMonitorByGeometry(currentMonitor, monitorDirection);
    }
    if (targetMonitor < 0) return targetMonitor;
    let monWs = Utils.createMonitorWorkspaceId(
      targetMonitor,
      nodeWindow.nodeValue.get_workspace().index()
    );
    monitorNode = this.findNode(monWs);
    return monitorNode;
  }

  /**
   * Find the nearest monitor adjacent to `currentMonitor` in the given
   * Meta.DisplayDirection, computed purely from monitor geometries. Used as a
   * fallback when get_monitor_neighbor_index() returns -1 for a real neighbor.
   * Returns the neighbor monitor index, or -1 when there is none.
   */
  _neighborMonitorByGeometry(currentMonitor, direction) {
    const cur = global.display.get_monitor_geometry(currentMonitor);
    if (!cur) return -1;
    const count = global.display.get_n_monitors();
    const D = Meta.DisplayDirection;
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < count; i++) {
      if (i === currentMonitor) continue;
      const c = global.display.get_monitor_geometry(i);
      if (!c) continue;
      const hOverlap = c.x < cur.x + cur.width && c.x + c.width > cur.x;
      const vOverlap = c.y < cur.y + cur.height && c.y + c.height > cur.y;
      let dist = -1;
      if (direction === D.UP && hOverlap && c.y < cur.y) dist = cur.y - c.y;
      else if (direction === D.DOWN && hOverlap && c.y > cur.y) dist = c.y - cur.y;
      else if (direction === D.LEFT && vOverlap && c.x < cur.x) dist = cur.x - c.x;
      else if (direction === D.RIGHT && vOverlap && c.x > cur.x) dist = c.x - cur.x;
      // Nearest edge wins; ties resolve to the lowest index (loop order).
      if (dist >= 0 && dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    return best;
  }

  findAncestorMonitor(node) {
    return this.findAncestor(node, NODE_TYPES.MONITOR);
  }

  findAncestor(node, ancestorType) {
    let ancestorNode;

    while (node && ancestorType && !node.isRoot()) {
      if (node.isType(ancestorType)) {
        ancestorNode = node;
        break;
      } else {
        node = node.parentNode;
      }
    }

    return ancestorNode;
  }

  nextVisible(node, direction) {
    if (!node) return null;
    let next = this.next(node, direction);
    // next() returns the numeric -1 sentinel at a monitor boundary (nextMonitor).
    // Normalize it to null so callers (e.g. _handleResizing) never mistake the
    // primitive -1 for a node and assign .percent on it.
    if (next === -1) return null;
    if (next && next.nodeType === NODE_TYPES.WINDOW && next.nodeValue && next.nodeValue.minimized) {
      next = this.nextVisible(next, direction);
    }
    return next;
  }

  /**
   * Credits: i3-like split
   */
  split(node, orientation, forceSplit = false) {
    if (!node) return;
    let type = node.nodeType;

    if (type === NODE_TYPES.WINDOW && node.mode === Window.WINDOW_MODES.FLOAT) {
      return;
    }

    if (!(type === NODE_TYPES.MONITOR || type === NODE_TYPES.CON || type === NODE_TYPES.WINDOW)) {
      return;
    }

    let parentNode = node.parentNode;
    let numChildren = parentNode.childNodes.length;

    // toggle the split
    if (
      !forceSplit &&
      numChildren === 1 &&
      (parentNode.layout === LAYOUT_TYPES.HSPLIT || parentNode.layout === LAYOUT_TYPES.VSPLIT)
    ) {
      parentNode.layout =
        orientation === ORIENTATION_TYPES.HORIZONTAL ? LAYOUT_TYPES.HSPLIT : LAYOUT_TYPES.VSPLIT;
      this.attachNode = parentNode;
      return;
    }

    // Push down the Meta.Window into a new Container
    let currentIndex = node.index;
    let container = new St.Bin();
    let newConNode = new Node(NODE_TYPES.CON, container);
    newConNode.settings = this.settings;

    // Take the direction of the parent
    newConNode.layout =
      orientation === ORIENTATION_TYPES.HORIZONTAL ? LAYOUT_TYPES.HSPLIT : LAYOUT_TYPES.VSPLIT;
    newConNode.rect = node.rect;
    newConNode.percent = node.percent;
    newConNode.parentNode = parentNode;
    parentNode.childNodes[currentIndex] = newConNode;
    this.createNode(container, node.nodeType, node.nodeValue);
    node.parentNode = newConNode;
    this.attachNode = newConNode;
  }

  swap(node, direction) {
    let nextSwapNode = this.next(node, direction);
    if (!nextSwapNode) {
      return;
    }
    let nodeSwapType = nextSwapNode.nodeType;

    switch (nodeSwapType) {
      case NODE_TYPES.WINDOW:
        break;
      case NODE_TYPES.CON:
      case NODE_TYPES.MONITOR:
        let childWindowNodes = nextSwapNode
          .getNodeByMode(Window.WINDOW_MODES.TILE)
          .filter((t) => t.nodeType === NODE_TYPES.WINDOW);
        if (nextSwapNode.layout === LAYOUT_TYPES.STACKED) {
          nextSwapNode = childWindowNodes[childWindowNodes.length - 1];
        } else {
          nextSwapNode = childWindowNodes[0];
        }
        break;
    }

    let isNextNodeWin =
      nextSwapNode && nextSwapNode.nodeValue && nextSwapNode.nodeType === NODE_TYPES.WINDOW;
    if (isNextNodeWin) {
      if (!this.extWm.sameParentMonitor(node, nextSwapNode)) {
        // Cross-monitor swaps are not supported due to coordinate system complexity.
        // Attempting to swap windows across monitors can cause rendering issues.
        // This is a known limitation to ensure stability.
        return;
      }
      this.swapPairs(node, nextSwapNode);
    }
    return nextSwapNode;
  }

  swapPairs(fromNode, toNode, focus = true) {
    if (!(this._swappable(fromNode) && this._swappable(toNode))) return;

    // Bug #324 fix: Validate windows still exist (after sleep/resume).
    // A null nodeValue also skips now - it would crash on get_frame_rect below.
    if (!Utils.isWindowAlive(fromNode?.nodeValue)) {
      Logger.warn("swapPairs: fromNode window destroyed, skipping swap");
      return;
    }
    if (!Utils.isWindowAlive(toNode?.nodeValue)) {
      Logger.warn("swapPairs: toNode window destroyed, skipping swap");
      return;
    }

    // Swap the items in the array
    let parentForFrom = fromNode ? fromNode.parentNode : undefined;
    let parentForTo = toNode.parentNode;
    if (parentForTo && parentForFrom) {
      let nextIndex = toNode.index;
      let focusIndex = fromNode.index;

      let transferMode = fromNode.mode;
      fromNode.mode = toNode.mode;
      toNode.mode = transferMode;

      // Bug #354 fix: Validate frame rects before swap
      let transferRect = fromNode.nodeValue.get_frame_rect();
      let transferToRect = toNode.nodeValue.get_frame_rect();
      if (!transferRect || !transferToRect) {
        Logger.warn("swapPairs: invalid frame rects");
        return;
      }
      let transferPercent = fromNode.percent;

      fromNode.percent = toNode.percent;
      toNode.percent = transferPercent;

      parentForTo.childNodes[nextIndex] = fromNode;
      fromNode.parentNode = parentForTo;
      parentForFrom.childNodes[focusIndex] = toNode;
      toNode.parentNode = parentForFrom;

      this.extWm.move(fromNode.nodeValue, transferToRect);
      this.extWm.move(toNode.nodeValue, transferRect);

      if (focus) {
        // The fromNode is now on the parent-target
        fromNode.nodeValue.raise();
        fromNode.nodeValue.focus(global.get_current_time());
      }
    }
  }

  _swappable(node) {
    if (!node) return false;
    if (node.nodeType === NODE_TYPES.WINDOW && !node.nodeValue.minimized) {
      return true;
    }
    return false;
  }

  /**
   * Performs cleanup of dangling parents in addition to removing the
   * node from the parent.
   */
  removeNode(node) {
    // Guard against an already-detached node: removeChild nulls parentNode after
    // detach, and a malformed/partially-built tree (or a reordered cleanup
    // sequence) can hand one in. Dereferencing node.parentNode.childNodes below
    // would throw mid-cleanup, aborting the destroy handler and leaving a
    // half-cleaned tree for the next render (forge-nmdo).
    if (!node || !node.parentNode) return false;

    // forge-wrot: a removed WINDOW owns a tab St.BoxLayout (+buttons +signals) in
    // its stacked/tabbed parent's decoration. This is the genuine-removal entry
    // (windowDestroy, cleanTree), as opposed to removeChild which also detaches
    // for reparenting — so tear the window tab down HERE so a window closed in a
    // multi-tab container doesn't leak it. _destroyTab no-ops when there's none.
    if (node.isWindow() && node.tab) node._destroyTab();

    let oldChild;

    let cleanUpParent = (existParent) => {
      if (this.getTiledChildren(existParent.childNodes).length === 0) {
        existParent.percent = 0.0;
        // Bug #470 fix: Don't reset sibling percents across workspace/monitor boundaries
        // This was causing tiling disruption in other workspaces when closing all windows
        if (
          existParent.parentNode &&
          !existParent.parentNode.isWorkspace() &&
          !existParent.parentNode.isMonitor()
        ) {
          this.resetSiblingPercent(existParent.parentNode);
        }
      }
      // Bug #470 fix: Only reset siblings within CON level, not workspace/monitor level
      if (!existParent.isWorkspace() && !existParent.isMonitor()) {
        this.resetSiblingPercent(existParent);
      }
    };

    let parentNode = node.parentNode;
    // If parent has only this window, remove the parent instead
    if (parentNode.childNodes.length === 1 && parentNode.nodeType !== NODE_TYPES.MONITOR) {
      let existParent = parentNode.parentNode;
      oldChild = existParent.removeChild(parentNode);
      cleanUpParent(existParent);
    } else {
      let existParent = node.parentNode;
      oldChild = existParent.removeChild(node);
      if (!this.extWm.floatingWindow(node)) cleanUpParent(existParent);
    }

    // If only a single tab remains, exit tabbed layout
    if (
      this.settings.get_boolean("auto-exit-tabbed") &&
      parentNode.nodeType === NODE_TYPES.CON &&
      parentNode.layout === LAYOUT_TYPES.TABBED &&
      parentNode.childNodes.length === 1
    ) {
      parentNode.layout = this.extWm.determineSplitLayout();
      this.resetSiblingPercent(parentNode);
      parentNode.lastTabFocus = null;
    }

    // MONITOR nodes persist with the workspace. When the last window leaves,
    // reset the layout to this monitor's geometry-based default (forge-5ng:
    // portrait splits vertically, landscape horizontally) so the next windows
    // start from the right orientation instead of a leftover LayoutToggle.
    if (parentNode.nodeType === NODE_TYPES.MONITOR && parentNode.childNodes.length === 0) {
      parentNode.layout = this.extWm.determineSplitLayoutForRect(parentNode.rect);
    }

    if (node === this.attachNode) {
      this.attachNode = null;
    } else {
      // Find the next focus node as attachNode
      this.attachNode = this.findNode(this.extWm.focusMetaWindow);
    }

    return oldChild ? true : false;
  }

  render(from) {
    Logger.debug(`render tree ${from ? "from " + from : ""}`);
    this.processNode(this);
    this.apply(this);
    // cleanTree() may mutate the structure (orphan/invalid removal or single-child
    // CON flatten). When it does, own the single re-layout here so a flatten-only
    // mutation isn't left with stale renderRects (forge-tdap).
    if (this.cleanTree()) {
      this.processNode(this);
      this.apply(this);
    }
    Logger.debug(`*********************************************`);
  }

  apply(node) {
    if (!node) return;
    let tiledChildren = node
      .getNodeByMode(Window.WINDOW_MODES.TILE)
      // forge-fw8: a fullscreen window keeps mode TILE; never re-slice it to its
      // split rect (that shifts/crops it over Mutter's full-monitor geometry).
      .filter(
        (t) =>
          t.nodeType === NODE_TYPES.WINDOW &&
          !(t.nodeValue.is_fullscreen && t.nodeValue.is_fullscreen())
      );
    tiledChildren.forEach((w) => {
      if (w.renderRect) {
        if (w.renderRect.width > 0 && w.renderRect.height > 0) {
          let metaWin = w.nodeValue;
          this.extWm.move(metaWin, w.renderRect);
        } else {
          Logger.debug(`ignoring apply for ${w.renderRect.width}x${w.renderRect.height}`);
        }
      }

      if (w.nodeValue.firstRender) w.nodeValue.firstRender = false;
    });
  }

  cleanTree() {
    // Phase 1: remove any cons with empty children
    const orphanCons = this.getNodeByType(NODE_TYPES.CON).filter((c) => c.childNodes.length === 0);
    const hasOrphanCons = orphanCons.length > 0;

    orphanCons.forEach((o) => {
      this.removeNode(o);
    });

    const invalidWindows = this.getNodeByType(NODE_TYPES.WINDOW).filter((w) => {
      const metaWindow = w.nodeValue;
      const title = metaWindow.title;
      const wmClass = metaWindow.wm_class;
      return wmClass === "gjs";
    });

    invalidWindows.forEach((w) => {
      this.removeNode(w);
    });

    // Phase 2: Flatten nested single-child containers
    // [con[con[con[window]]]] --> [con[window]]
    // `flattened` is the per-iteration loop control (always false on exit);
    // `didFlatten` accumulates whether ANY flatten happened, for the return below.
    let didFlatten = false;
    let flattened = true;
    while (flattened) {
      flattened = false;
      const nestedCons = this.getNodeByType(NODE_TYPES.CON).filter(
        (c) => c.childNodes.length === 1 && c.childNodes[0].nodeType === NODE_TYPES.CON
      );

      for (const parent of nestedCons) {
        const child = parent.childNodes[0];
        // forge-gdsz: a stacked/tabbed CON owns its child windows' tab actors in
        // its decoration. removeChild(child) below calls decoration.destroy_all_children(),
        // which would destroy the tab actors of grandchild windows that survive the
        // flatten (they are reparented to `parent`), leaving node.tab dangling so the
        // next render throws on the deallocated actor. Null each surviving window's
        // tab BEFORE removeChild so _createWindowTab (early-returns on this.tab)
        // rebuilds it fresh under the new parent on the next render. STACKED is
        // included because it shares the same decoration + tab-actor infrastructure
        // as TABBED, and removeChild now tears its decoration down too.
        const wasStackedOrTabbed = child.isStackedOrTabbed();
        // Move all grandchildren to parent
        const grandchildren = [...child.childNodes];
        for (const grandchild of grandchildren) {
          if (wasStackedOrTabbed && grandchild.tab) {
            // The tab actor lives in `child`'s decoration and is about to be
            // destroyed wholesale by removeChild below; drop the dangling
            // reference (else node.tab points at a deallocated actor and the next
            // render throws on it) and rebuild a fresh tab under the new parent.
            // _createWindowTab early-returns when this.tab is set, so it only
            // rebuilds because we nulled it; CON header tabs regenerate via
            // _ensureConTab each render once _tabRep is cleared.
            grandchild.tab = null;
            grandchild._tabRep = null;
            if (grandchild.isWindow()) grandchild._createWindowTab();
          }
          parent.appendChild(grandchild);
        }
        // Inherit layout from child if it has one
        if (child.layout && child.layout !== LAYOUT_TYPES.ROOT) {
          parent.layout = child.layout;
        }
        // Remove the now-empty intermediate container
        parent.removeChild(child);
        flattened = true;
        didFlatten = true;
        break; // Restart the loop after modification
      }
    }

    // Report whether the structure changed so render() can re-layout exactly once.
    // Flatten-only mutations previously skipped re-layout, stranding stale
    // renderRects until an unrelated later render (forge-tdap).
    return hasOrphanCons || invalidWindows.length > 0 || didFlatten;
  }

  /**
   * Per-title-bar height (DPI-scaled) for stacked/tabbed decorations (forge-1a5).
   * Read live so the prefs spinner takes effect without an extension reload.
   * The schema clamps the value to >= 1 so it never collides with the
   * stackedHeight === 0 "decoration hidden" path.
   */
  stackedBarHeight() {
    return this.settings.get_uint("stacked-tab-bar-height") * Utils.dpi();
  }

  /**
   * Where the stacked/tabbed title bar sits within its container: "top"
   * (default) or "bottom" (forge-drf). Read live so the prefs dropdown takes
   * effect without an extension reload. Anything other than "bottom" is treated
   * as "top" so an empty/unknown value falls back safely.
   */
  tabPosition() {
    return this.settings.get_string("tab-position") === "bottom" ? "bottom" : "top";
  }

  /**
   * Flip a decoration's content/bar anchors for "top" vs "bottom" (forge-drf).
   * Shared by processStacked/processTabbed and _applyDecorationRect so the three
   * Y anchors that must move together cannot drift. `barSize` is the caller's
   * ALREADY-CAPPED bar span (stacked passes totalBars, tabbed passes
   * stackedHeight) — this helper does NOT re-apply the forge-aydd clamp; the
   * caller still owns the `Math.max(height - barSize, 1)` content-height guard.
   *   top:    content below the bar (contentY = rectY + barSize), bar at rectY.
   *   bottom: content at the top (contentY = rectY), bar pinned to the bottom.
   */
  decorationLayout(rectY, height, barSize, position) {
    if (position === "bottom") {
      return { contentY: rectY, decorationY: rectY + height - barSize };
    }
    return { contentY: rectY + barSize, decorationY: rectY };
  }

  /**
   *
   * Credits: Do the i3-like calculations
   *
   */
  processNode(node) {
    if (!node) return;

    // Render the Root, Workspace and Monitor
    // For now, we let them render their children recursively
    if (node.nodeType === NODE_TYPES.ROOT) {
      node.childNodes.forEach((child) => {
        this.processNode(child);
      });
    }

    if (node.nodeType === NODE_TYPES.WORKSPACE) {
      node.childNodes.forEach((child) => {
        this.processNode(child);
      });
    }

    let params = {};

    if (node.nodeType === NODE_TYPES.MONITOR || node.nodeType === NODE_TYPES.CON) {
      // The workarea from Meta.Window's assigned monitor
      // is important so it computes to `remove` the panel size
      // really well. However, this type of workarea would only
      // appear if there is window present on the monitor.
      if (node.childNodes.length === 0) {
        return;
      }

      // If monitor, get the workarea
      if (node.nodeType === NODE_TYPES.MONITOR) {
        let monitorIndex = Utils.monitorIndex(node.nodeValue);
        let wsIndex = Utils.workspaceIndex(node.nodeValue);
        let workspaceMgr = global.display.get_workspace_manager();
        // Use the workspace that this monitor node belongs to, not always the active workspace
        let workspace = workspaceMgr.get_workspace_by_index(wsIndex);
        if (!workspace) {
          // Fallback to active workspace if the index is invalid
          workspace = workspaceMgr.get_active_workspace();
        }
        let monitorArea = workspace.get_work_area_for_monitor(monitorIndex);
        if (!monitorArea) return; // there is no visible child window
        node.rect = this.applyMargins(monitorArea);
        node.rect = this.processGap(node);
      }

      let tiledChildren = this.getTiledChildren(node.childNodes);
      let sizes = this.computeSizes(node, tiledChildren);

      params.sizes = sizes;
      let showTabs = this.settings.get_boolean("showtab-decoration-enabled");
      params.stackedHeight = showTabs ? this.stackedBarHeight() : 0;
      params.tiledChildren = tiledChildren;

      let decoration = node.decoration;

      if (decoration) {
        let decoChildren = decoration.get_children();
        decoChildren.forEach((decoChild) => {
          decoration.remove_child(decoChild);
        });
      }

      tiledChildren.forEach((child, index) => {
        // A monitor can contain a window or container child
        if (node.layout === LAYOUT_TYPES.HSPLIT || node.layout === LAYOUT_TYPES.VSPLIT) {
          this.processSplit(node, child, params, index);
        } else if (node.layout === LAYOUT_TYPES.STACKED) {
          // Bug #57 (forge-37r): nested CON children need their own header tab.
          if (child.isCon()) child._ensureConTab();
          this.processStacked(node, child, params, index);
        } else if (node.layout === LAYOUT_TYPES.TABBED) {
          // Bug #57 (forge-37r): nested CON children need their own header tab.
          if (child.isCon()) child._ensureConTab();
          this.processTabbed(node, child, params, index);
        }
        this.processNode(child);
      });
    }

    if (node.isWindow()) {
      if (!node.rect) {
        const wa = Utils.getWorkAreaSafe(node.nodeValue);
        if (wa) node.rect = wa;
      }
      // A monitor-less window (get_monitor() === -1) leaves node.rect unset;
      // processGap dereferences node.rect, so skip it and let a later render —
      // once Mutter assigns a monitor — produce the renderRect. forge-tpgh.
      if (node.rect) node.renderRect = this.processGap(node);
    }
  }

  /**
   * Forge processes both non-Window and Window gaps
   */
  processGap(node) {
    let nodeWidth = node.rect.width;
    let nodeHeight = node.rect.height;
    let nodeX = node.rect.x;
    let nodeY = node.rect.y;
    let gap = this.extWm.calculateGaps(node);

    // Bug #411 fix: Skip gaps for Waydroid (non-standard frame extents)
    if (node.isWindow() && node.nodeValue) {
      const wmClass = node.nodeValue.get_wm_class();
      if (wmClass && wmClass.toLowerCase().includes("waydroid")) {
        return { x: nodeX, y: nodeY, width: nodeWidth, height: nodeHeight };
      }
    }

    if (nodeWidth > gap * 2 && nodeHeight > gap * 2) {
      nodeX += gap;
      nodeY += gap;

      // Note: Gap calculation applies uniform padding. Future improvements could:
      // - Detect adjacent windows and share gap space between them
      // - Adjust gaps based on display scaling factor
      // See: https://github.com/forge-ext/forge for feature requests
      nodeWidth -= gap * 2;
      nodeHeight -= gap * 2;
    }
    return { x: nodeX, y: nodeY, width: nodeWidth, height: nodeHeight };
  }

  /**
   * Apply screen edge margins from settings to the work area rect.
   * This shrinks the available tiling area to avoid overlapping auto-hide panels/docks.
   * @param {Object} rect - The work area rectangle {x, y, width, height}
   * @returns {Object} - The adjusted rectangle with margins applied
   */
  applyMargins(rect) {
    const marginTop = this.settings.get_uint("window-margin-top");
    const marginBottom = this.settings.get_uint("window-margin-bottom");
    const marginLeft = this.settings.get_uint("window-margin-left");
    const marginRight = this.settings.get_uint("window-margin-right");

    return {
      x: rect.x + marginLeft,
      y: rect.y + marginTop,
      width: rect.width - marginLeft - marginRight,
      height: rect.height - marginTop - marginBottom,
    };
  }

  processSplit(node, child, params, index) {
    let layout = node.layout;
    let nodeRect = node.rect;
    let nodeWidth;
    let nodeHeight;
    let nodeX;
    let nodeY;

    if (layout === LAYOUT_TYPES.HSPLIT) {
      // Divide the parent container's width
      // depending on number of children. And use this
      // to setup each child window's width.
      nodeWidth = params.sizes[index];
      nodeHeight = nodeRect.height;
      nodeX = nodeRect.x;
      if (index != 0) {
        let i = 1;
        while (i <= index) {
          nodeX += params.sizes[i - 1];
          i++;
        }
      }
      nodeY = nodeRect.y;
    } else if (layout === LAYOUT_TYPES.VSPLIT) {
      // split vertically
      // Conversely for vertical split, divide the parent container's height
      // depending on number of children. And use this
      // to setup each child window's height.
      nodeWidth = nodeRect.width;
      nodeHeight = params.sizes[index];
      nodeX = nodeRect.x;
      nodeY = nodeRect.y;
      if (index != 0) {
        let i = 1;
        while (i <= index) {
          nodeY += params.sizes[i - 1];
          i++;
        }
      }
    }

    child.rect = {
      x: nodeX,
      y: nodeY,
      width: nodeWidth,
      height: nodeHeight,
    };
  }

  /**
   * Size/position the stacked or tabbed decoration host and attach the child's
   * tab (forge-u8ni). Both layouts share the gap/border probe, the adjust math,
   * the guarded set_size/set_position + show/hide, the _destroyDecoration()
   * self-heal, and the tab add — they differ only in the decoration's bar
   * dimension (`barSize`) and whether the tab y-expands to fill a vertical
   * column (`tabExpand`). Orientation and the child rect stay caller-side. A
   * placement or self-heal fix belongs here, once, so the two layouts cannot
   * drift.
   */
  _applyDecorationRect(node, child, params, barSize, tabExpand) {
    let gap = this.extWm.calculateGaps(node);
    let renderRect = this.processGap(node);
    let position = this.tabPosition();
    // Only window actors carry a themed border; a CON header tab contributes none
    // (forge-37r) — guard so CON children don't throw on a null border.
    let borderWidth =
      child.isWindow() && child.actor && child.actor.border
        ? child.actor.border.get_theme_node().get_border_width(St.Side.TOP)
        : 0;

    let adjust = DECORATION_ADJUST_FACTOR * Utils.dpi();
    let adjustWidth = renderRect.width + (borderWidth * 2 + gap) / adjust;
    let adjustX = renderRect.x - (gap + borderWidth * 2) / (adjust * 2);
    // Top keeps the original gap/adjust nuance (don't regress pixel placement);
    // bottom pins the bar to the container's lower edge (forge-drf). The helper
    // owns the bottom anchor; the top branch keeps its existing adjust term.
    let adjustY =
      position === "bottom"
        ? this.decorationLayout(renderRect.y, renderRect.height, barSize, position).decorationY
        : gap === 0
        ? renderRect.y
        : renderRect.y - adjust;

    // Callers reach this only inside `if (node.decoration && ...)`, so the host
    // is non-null here. The try/catch — not a null-check — is the Bug #303 /
    // forge-s7qo defense: a throw self-heals via _destroyDecoration so the tab
    // bar recreates next render instead of vanishing for the rest of the session.
    let decoration = node.decoration;
    try {
      decoration.set_size(adjustWidth, barSize);
      decoration.set_position(adjustX, adjustY);
      if (params.tiledChildren.length > 0 && params.stackedHeight !== 0) {
        decoration.show();
      } else {
        decoration.hide();
      }
      // Attach the tab. y_expand differs by layout: a stacked column stretches
      // each tab over its share of the vertical strip; a horizontal tab row does
      // not (reset it in case this tab was just toggled over from stacked).
      if (child.tab && !decoration.contains(child.tab)) {
        child.tab.y_expand = tabExpand;
        decoration.add_child(child.tab);
      }
    } catch (e) {
      Logger.warn(`Failed to update decoration: ${e}`);
      // Destroy the orphaned header before nulling: _createDecoration's
      // contains() guard tests the NEW actor, so the old St.BoxLayout would
      // otherwise stay parented in window_group forever (forge-ogmd). A second
      // throw on a finalized actor must not escape the render loop.
      node._destroyDecoration();
    }
    child.render();
  }

  /**
   * Ensure `node` has a decoration host laid out along `orientation`. Shared by
   * processStacked (VERTICAL column) and processTabbed (HORIZONTAL row).
   *
   * The _createDecoration call doubles as the forge-s7qo self-heal: it is
   * otherwise only invoked from the Node constructor, so without recreating it
   * here a single decoration throw (nulled in _applyDecorationRect's catch) would
   * leave the tab bar gone for the rest of the session. It early-returns when a
   * decoration already exists, so it is a no-op on the normal path.
   *
   * Setting the orientation every render also re-homes a host just toggled
   * between stacked and tabbed. St.BoxLayout.vertical was deprecated on GNOME
   * 48/49 and removed on GNOME 50, so drive it via Clutter.Orientation.
   */
  _ensureDecoration(node, orientation) {
    if (!node.decoration) node._createDecoration();
    node.decoration.orientation = orientation;
  }

  processStacked(node, child, params, _index) {
    // Mirror processTabbed, but lay the per-child header tabs out as a vertical
    // column (i3 "stacked"): N title bars at the top, the focused window fills the
    // area below them. Reuses the same tab actors (_createWindowTab/_ensureConTab)
    // and decoration host as tabbed.
    this._ensureDecoration(node, Clutter.Orientation.VERTICAL);

    let nodeRect = node.rect;
    let stackHeight = params.stackedHeight;
    let count = params.tiledChildren.length;
    let totalBars = stackHeight * count;

    // forge-aydd: when the title-bar column is taller than the container (many
    // stacked headers), cap the content offset so the window stays inside the
    // container instead of being pushed off the bottom. The decoration keeps the
    // full (uncapped) totalBars height below — i3 squeezes the content, not the
    // header column. Clamp at 0 so a degenerate (<=0) container height never
    // produces a negative offset.
    let cappedBars = Math.min(totalBars, Math.max(nodeRect.height - 1, 0));

    // Every child gets the same area beside the title-bar column; the focused one is
    // raised on top (focus handling lives in getFocusOnAttach/findNextFocus). The
    // helper flips the content anchor for tab-position top vs bottom (forge-drf);
    // the content HEIGHT is the same either way (the bar span is cappedBars).
    let { contentY } = this.decorationLayout(
      nodeRect.y,
      nodeRect.height,
      cappedBars,
      this.tabPosition()
    );
    child.rect = {
      x: nodeRect.x,
      y: contentY,
      width: nodeRect.width,
      // Guard against a degenerate negative height when many stacked headers
      // exceed the container (i3 has the same too-many-headers limit).
      height: Math.max(nodeRect.height - cappedBars, 1),
    };

    if (node.decoration && (child.isWindow() || child.isCon())) {
      // Stacked: the decoration spans the full N-bar column height; each tab
      // y-expands to share that column.
      this._applyDecorationRect(node, child, params, totalBars, true);
    }
  }

  /**
   * Process the child node here for the dimensions of the child tab/window,
   * It will be moved to the Node class in the future as Node.render()
   *
   */
  processTabbed(node, child, params, _index) {
    this._ensureDecoration(node, Clutter.Orientation.HORIZONTAL);

    let layout = node.layout;
    let nodeRect = node.rect;
    let nodeWidth;
    let nodeHeight;
    let nodeX;
    let nodeY;

    if (layout === LAYOUT_TYPES.TABBED) {
      nodeWidth = nodeRect.width;
      nodeX = nodeRect.x;
      nodeY = nodeRect.y;
      nodeHeight = nodeRect.height;

      let alwaysShowDecorationTab = true;

      if (node.childNodes.length > 1 || alwaysShowDecorationTab) {
        // Flip the content anchor for tab-position top vs bottom (forge-drf); the
        // tabbed bar span is stackedHeight (single row). The content HEIGHT is the
        // same either way — only the anchor moves.
        ({ contentY: nodeY } = this.decorationLayout(
          nodeRect.y,
          nodeRect.height,
          params.stackedHeight,
          this.tabPosition()
        ));
        // forge-aydd: never let a sub-tab-bar-height container yield a negative height.
        nodeHeight = Math.max(nodeRect.height - params.stackedHeight, 1);
        if (node.decoration && (child.isWindow() || child.isCon())) {
          // Tabbed: the decoration is a single tab-strip row; the tab does not
          // y-expand (it distributes along the horizontal strip).
          this._applyDecorationRect(node, child, params, params.stackedHeight, false);
        }
      }

      child.rect = {
        x: nodeX,
        y: nodeY,
        width: nodeWidth,
        height: nodeHeight,
      };
    }
  }

  computeSizes(node, childItems) {
    let sizes = [];
    let orientation = Utils.orientationFromLayout(node.layout);
    let totalSize =
      orientation === ORIENTATION_TYPES.HORIZONTAL ? node.rect.width : node.rect.height;
    let grabTiled = node.getNodeByMode(Window.WINDOW_MODES.GRAB_TILE).length > 0;
    childItems.forEach((childNode, index) => {
      let percent =
        childNode.percent && childNode.percent > 0.0 && !grabTiled
          ? childNode.percent
          : 1.0 / childItems.length;
      sizes[index] = Math.floor(percent * totalSize);
    });

    // forge-s6g: honor window minimum sizes by redistributing space (i3-style).
    // Only real splits place windows side-by-side; STACKED/TABBED give each
    // window the full container, so minimums can't be violated there. Skipped
    // during a grab (a drag must not fight min-resize) and inert when no child
    // reports a minimum in the split orientation.
    const isSplit = node.layout === LAYOUT_TYPES.HSPLIT || node.layout === LAYOUT_TYPES.VSPLIT;
    let mins = [];
    let minTotal = 0;
    if (isSplit && !grabTiled) {
      mins = childItems.map((childNode) => this._minSizeInOrientation(childNode, orientation));
      minTotal = mins.reduce((a, b) => a + b, 0);
      if (minTotal > 0) {
        this._redistributeForMinSizes(sizes, mins, minTotal, totalSize);
      }
    }

    // Bug #330 fix: Ensure total allocated size equals parent size. Fold the
    // rounding remainder onto the child with the most slack above its minimum
    // (legacy: the last child) so a min-constrained child is never pushed back
    // below its minimum by the correction.
    let totalAllocated = sizes.reduce((a, b) => a + b, 0);
    if (totalAllocated !== totalSize) {
      let foldIndex = minTotal > 0 ? this._mostShrinkableIndex(sizes, mins) : sizes.length - 1;
      sizes[foldIndex] += totalSize - totalAllocated;
    }
    return sizes;
  }

  // forge-s6g / forge-sbw3: minimum size of a node measured along the fixed
  // query axis (always the outer split's orientation). A WINDOW reports its own
  // size hint; a CON projects its tiled descendants' minimums — summed when the
  // CON splits along the query axis (children sit side-by-side), maxed otherwise
  // (perpendicular split, STACKED or TABBED, where children overlap on the axis).
  _minSizeInOrientation(node, orientation) {
    if (node.isWindow()) {
      if (!node.nodeValue) return 0;
      const hints = node.nodeValue.get_size_hints?.();
      if (!hints) return 0;
      const min = orientation === ORIENTATION_TYPES.HORIZONTAL ? hints.min_width : hints.min_height;
      return min > 0 ? min : 0;
    }
    if (node.isCon()) {
      const children = this.getTiledChildren(node.childNodes);
      if (children.length === 0) return 0;
      const mins = children.map((child) => this._minSizeInOrientation(child, orientation));
      const sideBySide =
        (node.layout === LAYOUT_TYPES.HSPLIT || node.layout === LAYOUT_TYPES.VSPLIT) &&
        Utils.orientationFromLayout(node.layout) === orientation;
      return sideBySide
        ? mins.reduce((a, b) => a + b, 0)
        : mins.reduce((a, b) => Math.max(a, b), 0);
    }
    return 0;
  }

  // forge-s6g: floor each child at its minimum and shrink the slack-bearing
  // siblings proportionally to absorb the deficit, preserving the total.
  _redistributeForMinSizes(sizes, mins, minTotal, totalSize) {
    // Container can't satisfy every minimum: fall back to a min-proportional
    // split so nothing goes negative and the column still fills the parent.
    if (minTotal >= totalSize) {
      for (let i = 0; i < sizes.length; i++) {
        sizes[i] = Math.floor((mins[i] / minTotal) * totalSize);
      }
      return;
    }
    let deficit = 0;
    let slackTotal = 0;
    for (let i = 0; i < sizes.length; i++) {
      if (sizes[i] < mins[i]) deficit += mins[i] - sizes[i];
      else slackTotal += sizes[i] - mins[i];
    }
    if (deficit === 0) return;
    // Raise constrained children to their minimum.
    for (let i = 0; i < sizes.length; i++) {
      if (sizes[i] < mins[i]) sizes[i] = mins[i];
    }
    if (slackTotal <= 0) return;
    // Shrink the slack-bearing children proportionally, never below their min.
    // slackTotal always exceeds the deficit here (totalSize - minTotal > 0), so
    // the deficit is fully absorbed; any rounding leftover is reconciled by the
    // Bug #330 correction in computeSizes().
    for (let i = 0; i < sizes.length && deficit > 0; i++) {
      const slack = sizes[i] - mins[i];
      if (slack <= 0) continue;
      const take = Math.min(slack, Math.round((deficit * slack) / slackTotal));
      sizes[i] -= take;
    }
  }

  // forge-s6g: index of the child with the most room above its minimum, used as
  // the safe target for the Bug #330 rounding remainder.
  _mostShrinkableIndex(sizes, mins) {
    let best = 0;
    let bestSlack = -Infinity;
    for (let i = 0; i < sizes.length; i++) {
      const slack = sizes[i] - (mins[i] || 0);
      if (slack > bestSlack) {
        bestSlack = slack;
        best = i;
      }
    }
    return best;
  }

  findFirstNodeWindowFrom(node) {
    let results = node.getNodeByType(NODE_TYPES.WINDOW);
    if (results.length > 0) {
      return results[0];
    }
    return null;
  }

  resetSiblingPercent(parentNode) {
    if (!parentNode) return;
    let children = parentNode.childNodes;
    children.forEach((n) => {
      n.percent = 0.0;
    });
  }

  /**
   * forge-7m3: Give a newly-added child a fair share of its parent while
   * preserving the existing tiled siblings' relative proportions, instead of
   * re-equalizing everything. Counterpart to redistributeSiblingPercent (which
   * handles removal). The new child may still be in FLOAT mode at this point
   * (it is tiled later during render), so it is handled explicitly rather than
   * via getTiledChildren.
   * @param {Node} parentNode - The parent container gaining a child
   * @param {Node} newChild - The newly-added child node
   */
  insertChildPercent(parentNode, newChild) {
    if (!parentNode || !newChild) return;
    const existing = this.getTiledChildren(parentNode.childNodes).filter((n) => n !== newChild);
    const existingTotal = existing.reduce((sum, n) => sum + (n.percent || 0), 0);
    // No custom sizes yet: keep the equal-split behavior (all zero -> equal).
    if (existingTotal <= 0) {
      existing.forEach((n) => (n.percent = 0.0));
      newChild.percent = 0.0;
      return;
    }
    // Existing windows were resized: carve an equal share for the newcomer and
    // scale the others down proportionally so the column still sums to 1.0.
    const share = 1.0 / (existing.length + 1);
    newChild.percent = share;
    const scale = (1.0 - share) / existingTotal;
    existing.forEach((n) => (n.percent = (n.percent || 0) * scale));
  }

  /**
   * Redistribute sibling percentages proportionally after a child is removed.
   * Preserves the relative sizes of remaining windows.
   * @param {Node} parentNode - The parent container
   */
  redistributeSiblingPercent(parentNode) {
    if (!parentNode) return;
    let children = parentNode.childNodes;
    if (children.length === 0) return;

    // Calculate sum of remaining children's percents
    let totalPercent = 0;
    children.forEach((n) => {
      totalPercent += n.percent || 0;
    });

    if (totalPercent > 0) {
      // Scale remaining children proportionally to sum to 1.0
      const scale = 1.0 / totalPercent;
      children.forEach((n) => {
        n.percent = (n.percent || 0) * scale;
      });
    } else {
      // Fallback: if no percents were set, use equal distribution
      children.forEach((n) => {
        n.percent = 1.0 / children.length;
      });
    }
  }

  debugParentNodes(node) {
    if (node) {
      if (node.parentNode) {
        this.debugParentNodes(node.parentNode);
      }
      this.debugNode(node);
    }
  }

  debugNode(node) {
    let spacing = "";
    let dashes = "-->";
    let level = node.level;
    for (let i = 0; i < level; i++) {
      let parentSpacing = i === 0 ? " " : "|";
      spacing += `${parentSpacing}   `;
    }
    let rootSpacing = level === 0 ? "#" : "*";

    let attributes = "";

    if (node.isWindow && node.isWindow()) {
      let metaWindow = node.nodeValue;
      attributes += `class:'${metaWindow.get_wm_class()}',title:'${
        metaWindow.title
      }',string:'${metaWindow}'${metaWindow === this.extWm.focusMetaWindow ? " FOCUS" : ""}`;
    } else if (node.isCon() || node.isMonitor() || node.isWorkspace()) {
      attributes += `${node.nodeValue}`;
      if (node.isCon() || node.isMonitor()) {
        attributes += `,layout:${node.layout}`;
      }
    }

    if (node.rect) {
      attributes += `,rect:${node.rect.width}x${node.rect.height}+${node.rect.x}+${node.rect.y}`;
      const pointerCoord = global.get_pointer();
      const pointerInside = Utils.rectContainsPoint(node.rect, pointerCoord) ? "yes" : "no";
      attributes += `,pointer:${pointerInside}`;
    }

    if (level !== 0) Logger.debug(`${spacing}|`);
    Logger.debug(
      `${spacing}${rootSpacing}${dashes} ${node.nodeType}#${
        node.index !== null ? node.index : "-"
      } @${attributes}`
    );
  }

  findParent(childNode, parentNodeType) {
    let parents = this.getNodeByType(parentNodeType);
    // Only get the first parent
    return parents.filter((p) => p.contains(childNode))[0];
  }
}
