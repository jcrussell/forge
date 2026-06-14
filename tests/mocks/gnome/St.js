// Mock St (Shell Toolkit) namespace
import { withSignals } from "../helpers/signalMixin.js";

export class Widget extends withSignals() {
  constructor(params = {}) {
    super();
    this.name = params.name || "";
    this.style_class = params.style_class || "";
    this.visible = params.visible !== false;
  }

  get_style_class_name() {
    return this.style_class;
  }

  set_style_class_name(name) {
    this.style_class = name;
  }

  add_style_class_name(name) {
    if (!this.style_class.includes(name)) {
      this.style_class += ` ${name}`;
    }
  }

  remove_style_class_name(name) {
    this.style_class = this.style_class.replace(name, "").trim();
  }

  show() {
    this.visible = true;
  }

  hide() {
    this.visible = false;
  }

  destroy() {
    // Mock destroy
  }

  grab_key_focus() {
    // Mock: actor-level key focus is a no-op in tests
  }

  remove_all_transitions() {
    // Mock: no in-flight Clutter transitions to cancel in tests
  }

  get_parent() {
    return this._parent || null;
  }

  set_size(width, height) {
    this.width = width;
    this.height = height;
  }

  set_position(x, y) {
    this.x = x;
    this.y = y;
  }

  // Clutter.Actor preferred-size queries: return [min, natural].
  get_preferred_width(_forHeight) {
    return [0, this.width || 0];
  }

  get_preferred_height(_forWidth) {
    return [0, this.height || 0];
  }

  // Clutter.Actor.ease: apply final values immediately and run onComplete
  // synchronously unless a test overrides this to control timing.
  ease(params = {}) {
    for (const [key, value] of Object.entries(params)) {
      if (key === "duration" || key === "mode" || key === "onComplete") continue;
      this[key] = value;
    }
    if (typeof params.onComplete === "function") params.onComplete();
  }
}

export class Bin extends Widget {
  constructor(params = {}) {
    super(params);
    this.child = params.child || null;
    this.children = [];
  }

  set_child(child) {
    this.child = child;
  }

  get_child() {
    return this.child;
  }

  add_child(child) {
    this.children.push(child);
  }

  remove_child(child) {
    const index = this.children.indexOf(child);
    if (index !== -1) {
      this.children.splice(index, 1);
    }
  }

  get_children() {
    return this.children;
  }

  get_child_at_index(index) {
    return this.children[index] || null;
  }

  contains(child) {
    return this.children.includes(child);
  }
}

export class BoxLayout extends Widget {
  constructor(params = {}) {
    super(params);
    this.children = [];
    this.vertical = params.vertical || false;
  }

  add_child(child) {
    this.children.push(child);
  }

  remove_child(child) {
    const index = this.children.indexOf(child);
    if (index !== -1) {
      this.children.splice(index, 1);
    }
  }

  get_children() {
    return this.children;
  }

  get_child_at_index(index) {
    return this.children[index] || null;
  }

  contains(child) {
    return this.children.includes(child);
  }

  destroy_all_children() {
    // Mirror Clutter: destroy and detach every child.
    const kids = this.children.splice(0);
    kids.forEach((c) => c.destroy && c.destroy());
  }
}

export class Label extends Widget {
  constructor(params = {}) {
    super(params);
    this.text = params.text || "";
  }

  get_text() {
    return this.text;
  }

  set_text(text) {
    this.text = text;
  }
}

export class Button extends Widget {
  constructor(params = {}) {
    super(params);
    this.label = params.label || "";
  }
}

// Module-level scale factor so tests can simulate HiDPI. get_for_stage returns a
// fresh instance per call, so the getter must read this shared var (not a field).
let _scaleFactor = 1;
export function __setScaleFactor(value) {
  _scaleFactor = value;
}
export function __resetScaleFactor() {
  _scaleFactor = 1;
}

export class ThemeContext {
  static get_for_stage(stage) {
    return new ThemeContext();
  }

  get_theme() {
    return {
      load_stylesheet: () => {},
      unload_stylesheet: () => {},
    };
  }

  get scale_factor() {
    return _scaleFactor;
  }
}

export class Icon extends Widget {
  constructor(params = {}) {
    super(params);
    this.gicon = params.gicon || null;
    this.icon_name = params.icon_name || "";
    this.icon_size = params.icon_size || 16;
  }
}

export default {
  Widget,
  Bin,
  BoxLayout,
  Label,
  Button,
  ThemeContext,
  Icon,
  __setScaleFactor,
  __resetScaleFactor,
};
