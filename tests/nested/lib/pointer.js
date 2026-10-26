// Play a sequence of pointer and key events inside the SANDBOX shell, one every __TICK_MS__ ms,
// with Clutter virtual devices. Parameters are substituted by harness.pointer():
//   __ACTIONS__: JSON list of ["move", x, y] | ["press", button] | ["release", button] |
//                ["key", keyval, 1|0] | ["wait", ms]
(() => {
  const ACTIONS = __ACTIONS__,
    TICK_MS = __TICK_MS__;
  const seat = global.stage.context.get_backend().get_default_seat();
  const ptr = seat.create_virtual_device(0 /* CLUTTER_POINTER_DEVICE */);
  const kb = seat.create_virtual_device(1 /* CLUTTER_KEYBOARD_DEVICE */);
  const now = () => GLib.get_monotonic_time();
  const st = (globalThis.__ptr = { log: [], done: false });
  const buttons = new Set();
  const keys = new Set();
  let k = 0;
  let waitUntil = 0;
  // Always release what is still held, even if a step throws
  const finish = () => {
    buttons.forEach((b) => ptr.notify_button(now(), b, 0));
    [...keys].reverse().forEach((key) => kb.notify_keyval(now(), key, 0));
    st.done = true;
  };
  GLib.timeout_add(GLib.PRIORITY_DEFAULT, TICK_MS, () => {
    try {
      if (now() < waitUntil) return GLib.SOURCE_CONTINUE;
      if (k < ACTIONS.length) {
        const [kind, a, b] = ACTIONS[k++];
        if (kind === "move") ptr.notify_absolute_motion(now(), a, b);
        else if (kind === "press") {
          ptr.notify_button(now(), a, 1);
          buttons.add(a);
        } else if (kind === "release") {
          ptr.notify_button(now(), a, 0);
          buttons.delete(a);
        } else if (kind === "key") {
          kb.notify_keyval(now(), a, b);
          if (b) keys.add(a);
          else keys.delete(a);
        } else if (kind === "wait") waitUntil = now() + a * 1000;
        return GLib.SOURCE_CONTINUE;
      }
    } catch (e) {
      st.log.push(`ERROR ${e}`);
    }
    finish();
    return GLib.SOURCE_REMOVE;
  });
  return "started";
})();
