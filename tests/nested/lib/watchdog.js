// Continuous layout watcher, run inside the (sandbox or real) shell for a whole scenario.
// Every ~16 ms (about one frame) it checks the tiled windows Forge manages on the active workspace,
// on every monitor: each is either fully visible or hidden behind windows of its own tabbed/stacked
// group (see below), and each is inside its monitor's work area. Each violation is recorded as an
// episode (start, duration, worst size), so short transitions and lasting problems can be told
// apart. Frames are what GNOME has applied (the frame rect), sampled as fast as the display draws.
// Each episode is also classified by what Forge last asked for (window.forgePendingFrame, set by
// Forge's move): "layout" if Forge's own requests overlap or leave the screen (a Forge layout bug),
// "lag" if the requests are fine but an app hasn't taken its new place yet (named in `lagging`),
// "stall" if that app didn't change its frame at all for STALL_MS or more (the app was busy),
// "drag" if a window is being moved with the mouse, or resized with it and out of place (GNOME
// places and sizes it then, not Forge),
// "opening" if one of the windows hasn't reached any place since it appeared (still where the app
// put it; Forge has asked for its place).
//   globalThis.__watchdog.report()  -> JSON {started_wall_ms, samples, episodes: [...]}
//   globalThis.__watchdog.stop()
(() => {
  const prev = globalThis.__watchdog;
  if (prev) prev.stop();
  const t0 = GLib.get_monotonic_time();
  const st = {
    t0,
    started_wall_ms: Date.now(),
    samples: 0,
    open: new Map(),
    episodes: [],
    id: 0,
    pending: new Map(),
    apps: {},
  };
  // An app that doesn't change its frame for this long while it should is stalled (Forge's
  // windows stop waiting for it after 500 ms): kind "stall", the app's doing, not Forge's
  const STALL_MS = 450;
  const now = () => Math.round((GLib.get_monotonic_time() - t0) / 1000);
  const groupOf = (n) => {
    for (let p = n.parentNode; p; p = p.parentNode)
      if (p.layout === "TABBED" || p.layout === "STACKED") return p;
    return null;
  };
  const label = (w) => `${w.get_id() % 1000}:${(w.get_wm_class() ?? "?").split(".").pop()}`;
  const sample = () => {
    const wm = Main.extensionManager.lookup("forge@jmmaranan.com")?.stateObj?.extWm;
    if (!wm?.tree) return;
    st.samples++;
    const ws = global.workspace_manager.get_active_workspace();
    const nodes = wm.tree.getNodeByType("WINDOW").filter((n) => {
      const w = n.nodeValue;
      return (
        w &&
        !w.minimized &&
        w.get_workspace() === ws &&
        !n.isFloat() &&
        w.showing_on_its_workspace()
      );
    });
    const seen = new Set();
    const hit = (key, what, size, cls, lagging, where = "") => {
      seen.add(key);
      let e = st.open.get(key);
      if (!e)
        st.open.set(
          key,
          (e = {
            what,
            where,
            start: now(),
            max: 0,
            layout_ms: 0,
            drag_ms: 0,
            opening_ms: 0,
            lagging: new Set(),
            frames: new Map(),
            stall_ms: 0,
          })
        );
      e.max = Math.max(e.max, size);
      if (cls === "layout") {
        e.layout_ms += 16;
        e.layout_at ??= now() - e.start;
        e.layout_where ??= where;
      }
      if (cls === "drag") e.drag_ms += 16;
      if (cls === "opening") e.opening_ms += 16;
      // How long a lagging app went without changing its frame at all (an app that stalls,
      // not one that is catching up)
      for (const w of lagging) {
        const l = label(w);
        e.lagging.add(l);
        const f = w.get_frame_rect(),
          k = `${f.x},${f.y},${f.width},${f.height}`;
        const seenFrame = e.frames.get(l);
        if (!seenFrame || seenFrame[0] !== k) e.frames.set(l, [k, now()]);
        else e.stall_ms = Math.max(e.stall_ms, now() - seenFrame[1]);
      }
    };
    const req = (w) => w.forgePendingFrame ?? w.get_frame_rect();
    const differs = (w) => {
      const f = w.get_frame_rect(),
        r = req(w);
      return (
        Math.max(
          Math.abs(f.x - r.x),
          Math.abs(f.y - r.y),
          Math.abs(f.width - r.width),
          Math.abs(f.height - r.height)
        ) > 2
      );
    };
    // A window moved or resized with the mouse is placed by GNOME, not by Forge's requests:
    // while Forge marks it grabbed, and while button 1 is held with the pointer on it and it is
    // away from its place (the first frame of a drag, before Forge has seen the grab begin)
    const [px, py, mods] = global.get_pointer();
    const button = (mods & imports.gi.Clutter.ModifierType.BUTTON1_MASK) !== 0;
    const underPointer = (w) => {
      const f = w.get_frame_rect();
      return px >= f.x && px < f.x + f.width && py >= f.y && py < f.y + f.height;
    };
    const dragged = (n) =>
      String(n.mode).includes("GRAB") ||
      (n.grabMode === "RESIZING" && differs(n.nodeValue)) ||
      (button && differs(n.nodeValue) && underPointer(n.nodeValue));
    const minOf = (w) => {
      try {
        const [has, mw, mh] = w.get_min_size();
        if (!has) return "none";
        const c = w.get_frame_rect();
        c.width = mw;
        c.height = mh;
        const m = w.client_rect_to_frame_rect(c);
        return `${m.width}x${m.height}`;
      } catch (e) {
        return "?";
      }
    };
    const outside = (a, f) =>
      Math.max(
        a.x - f.x,
        a.y - f.y,
        f.x + f.width - (a.x + a.width),
        f.y + f.height - (a.y + a.height)
      );
    const overlap = (a, b) =>
      Math.min(
        Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
        Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
      );
    // how long each app takes to take the place Forge asks for: from the first request it
    // hasn't applied yet (later requests supersede it, e.g. while a key repeats) until its frame
    // matches Forge's latest request
    for (const n of nodes) {
      const w = n.nodeValue,
        r = w.forgePendingFrame;
      if (!r) continue;
      const app = label(w).split(":")[1];
      const a = (st.apps[app] ??= { lag_ms: [], superseded: 0 });
      let e = st.pending.get(w);
      if (!e || e.req !== r) {
        if (e && !e.done) a.superseded++;
        // (a request already applied before watching started isn't counted)
        e = { req: r, since: e && !e.done ? e.since : r.time, done: !e && !differs(w) };
        st.pending.set(w, e);
      }
      if (!e.done && !differs(w)) {
        a.lag_ms.push(Math.round((GLib.get_monotonic_time() - e.since) / 1000));
        e.done = true;
      }
    }
    for (const n of nodes) if (!differs(n.nodeValue)) n.nodeValue.__watchPlaced = true;
    const rects = nodes.map((n) => [n, n.nodeValue.get_frame_rect()]);
    for (const [n, f] of rects) {
      const w = n.nodeValue,
        a = ws.get_work_area_for_monitor(w.get_monitor());
      const out = outside(a, f);
      if (out > 2) {
        const cls = dragged(n) ? "drag" : outside(a, req(w)) > 2 ? "layout" : "lag";
        hit(`off:${w.get_id()}`, `${label(w)} off-screen`, out, cls, differs(w) ? [w] : []);
      }
    }
    // What a person sees: each tiled window must be either fully visible, or fully covered by
    // windows of its own tabbed/stacked group (an inactive tab). A window partly covered by
    // another (even one of its group: e.g. the old stacked cascade), or covered by a window
    // outside its group, is an overlap. Slivers up to SLIVER px (the gaps between windows) don't
    // count as visible.
    const SLIVER = 24;
    const sub = (r, c) => {
      const x1 = Math.max(r.x, c.x),
        y1 = Math.max(r.y, c.y);
      const x2 = Math.min(r.x + r.width, c.x + c.width),
        y2 = Math.min(r.y + r.height, c.y + c.height);
      if (x2 <= x1 || y2 <= y1) return [r];
      return [
        { x: r.x, y: r.y, width: r.width, height: y1 - r.y },
        { x: r.x, y: y2, width: r.width, height: r.y + r.height - y2 },
        { x: r.x, y: y1, width: x1 - r.x, height: y2 - y1 },
        { x: x2, y: y1, width: r.x + r.width - x2, height: y2 - y1 },
      ].filter((p) => p.width > 0 && p.height > 0);
    };
    const byNode = new Map(rects.map(([n, f]) => [n.nodeValue, [n, f]]));
    const stacking = global.display.sort_windows_by_stacking([...byNode.keys()]);
    stacking.forEach((wa, i) => {
      const [na, fa] = byNode.get(wa);
      const above = stacking
        .slice(i + 1)
        .map((w) => byNode.get(w))
        .filter(([, f]) => overlap(fa, f) > 2);
      if (!above.length) return;
      let visible = [fa];
      for (const [, f] of above) visible = visible.flatMap((p) => sub(p, f));
      const shows = visible.some((p) => Math.min(p.width, p.height) > SLIVER);
      const g = groupOf(na);
      const hiddenTab = !shows && g && above.every(([nb]) => g.contains(nb));
      if (hiddenTab) return;
      // With title bars turned off, a stack is a cascade on purpose (each window's own title
      // bar shows above the next): not counted
      const cascade = g?.isStacked() && !wm.ext.settings.get_boolean("showtab-decoration-enabled");
      if (cascade && above.every(([nb]) => g.contains(nb))) return;
      for (const [nb, fb] of above) {
        const wb = nb.nodeValue;
        const ids = [wa.get_id(), wb.get_id()].sort();
        const byMouse = [na, nb].some(dragged);
        // A window that hasn't reached any place since it appeared is still opening (at
        // wherever the app put it until it draws the place Forge asked for)
        const opening = [wa, wb].some((w) => !w.__watchPlaced);
        // (windows of one tabbed/stacked group are asked for the same place: that they
        // overlap on the way there is lag, not layout)
        const sameGroup = g && g.contains(nb);
        const cls = byMouse
          ? "drag"
          : opening
          ? "opening"
          : overlap(req(wa), req(wb)) > 2 && !sameGroup
          ? "layout"
          : "lag";
        const r = (f) => `${f.x},${f.y} ${f.width}x${f.height}`;
        const path = (n) => {
          const p = [];
          for (let c = n.parentNode; c && c.nodeType !== "MONITOR"; c = c.parentNode)
            p.push(c.layout ?? c.nodeType);
          return p.join("<");
        };
        hit(
          `ov:${ids}`,
          `${label(wa)} ${shows ? "partly" : "fully"} covered by ${label(wb)}`,
          overlap(fa, fb),
          cls,
          [wa, wb].filter(differs),
          [
            [wa, fa, na],
            [wb, fb, nb],
          ]
            .map(
              ([w, f, n]) =>
                `${label(w)} at ${r(f)}${
                  differs(w) ? ` (asked ${r(req(w))}, min ${minOf(w)})` : ""
                } in ${path(n)}`
            )
            .join("; ")
        );
      }
    });
    for (const [key, e] of st.open) {
      if (!seen.has(key)) {
        st.episodes.push(done(e));
        st.open.delete(key);
      }
    }
  };
  const done = (e, extra = {}) => ({
    what: e.what,
    where: e.where,
    start_ms: e.start,
    duration_ms: now() - e.start,
    max_px: e.max,
    kind: e.layout_ms
      ? "layout"
      : e.drag_ms
      ? "drag"
      : e.opening_ms
      ? "opening"
      : e.stall_ms >= STALL_MS
      ? "stall"
      : "lag",
    layout_ms: e.layout_ms,
    drag_ms: e.drag_ms,
    layout_at_ms: e.layout_at,
    layout_where: e.layout_where,
    stall_ms: e.stall_ms,
    lagging: [...e.lagging],
    ...extra,
  });
  st.timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
    sample();
    return GLib.SOURCE_CONTINUE;
  });
  st.report = () =>
    JSON.stringify({
      started_wall_ms: st.started_wall_ms,
      samples: st.samples,
      apps: st.apps,
      episodes: st.episodes.concat([...st.open.values()].map((e) => done(e, { ongoing: true }))),
    });
  st.stop = () => {
    if (st.timer) GLib.source_remove(st.timer);
    st.timer = 0;
  };
  globalThis.__watchdog = st;
  return "watching";
})();
