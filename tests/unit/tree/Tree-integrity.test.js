import { describe, it, expect, beforeEach } from "vitest";
import { Node, NODE_TYPES, LAYOUT_TYPES } from "../../../lib/extension/tree.js";
import {
  createMockWindow,
  createTreeFixture,
  getWorkspaceAndMonitor,
  createWindowNode,
  createContainerNode,
} from "../../mocks/helpers/index.js";

/**
 * forge-fhen.5: Tree.verifyIntegrity() is the dev-build structural invariant
 * checker that catches the reparent/splice/single-parent corruption class
 * (forge-bomy, forge-v2yz, forge-mo27) at runtime. It walks ROOT over
 * childNodes/parentNode and collects EVERY violation of the canonical rule set
 * (parent-ref, duplicate-node, cycle, depth-exceeded, empty-con,
 * window-not-leaf) rather than stopping at the first. This is the pure
 * in-memory subset of the e2e oracle in bridge.js fuzzCheckInvariants();
 * geometry/shape checks stay in bridge.js.
 */
describe("forge-fhen.5: Tree.verifyIntegrity structural invariants", () => {
  let ctx;

  beforeEach(() => {
    ctx = createTreeFixture({ fullExtWm: true, settings: { "tiling-mode-enabled": true } });
  });

  const rulesOf = (tree) => tree.verifyIntegrity().map((v) => v.rule);

  it("reports no violations for the fresh scaffold tree", () => {
    expect(ctx.tree.verifyIntegrity()).toEqual([]);
  });

  it("reports no violations for a healthy tiled tree", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    createWindowNode(ctx.tree, monitor);
    createWindowNode(ctx.tree, monitor);
    const con = createContainerNode(monitor, LAYOUT_TYPES.VSPLIT);
    createWindowNode(ctx.tree, con);
    createWindowNode(ctx.tree, con);

    const violations = ctx.tree.verifyIntegrity();
    expect(violations).toEqual([]);
  });

  it("flags parent-ref when a child's parentNode disagrees with its container", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    const a = createWindowNode(ctx.tree, monitor).nodeWindow;
    const b = createWindowNode(ctx.tree, monitor).nodeWindow;

    // b stays in monitor.childNodes but its parentNode is repointed at a sibling.
    b.parentNode = a;

    const rules = rulesOf(ctx.tree);
    expect(rules).toContain("parent-ref");
    // The offending node is described in the returned entry.
    const entry = ctx.tree.verifyIntegrity().find((v) => v.rule === "parent-ref");
    expect(entry.ref).toBe(b);
    expect(typeof entry.node).toBe("string");
  });

  it("flags duplicate-node when one node object is reachable via two parents", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const a = createWindowNode(ctx.tree, monitor).nodeWindow;

    // Splice the SAME node object under a second live CON without detaching it.
    const con = createContainerNode(monitor, LAYOUT_TYPES.HSPLIT);
    con.childNodes.push(a);

    expect(rulesOf(ctx.tree)).toContain("duplicate-node");
  });

  it("flags empty-con for a CON node with zero children", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    createContainerNode(monitor, LAYOUT_TYPES.HSPLIT); // no children appended

    expect(rulesOf(ctx.tree)).toContain("empty-con");
  });

  it("flags window-not-leaf for a WINDOW node carrying children", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const a = createWindowNode(ctx.tree, monitor).nodeWindow;

    // A WINDOW is a leaf by construction; a corrupt insert gives it a child.
    const bogusChild = new Node(NODE_TYPES.WINDOW, createMockWindow());
    a.childNodes.push(bogusChild);
    bogusChild.parentNode = a;

    expect(rulesOf(ctx.tree)).toContain("window-not-leaf");
  });

  it("flags cycle when a node becomes its own ancestor", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const con = createContainerNode(monitor, LAYOUT_TYPES.HSPLIT);

    // con's child list re-includes its own ancestor -> self-ancestor cycle.
    con.childNodes.push(monitor);

    const rules = rulesOf(ctx.tree);
    expect(rules).toContain("cycle");
  });

  it("collects ALL violations in one pass rather than stopping at the first", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    const a = createWindowNode(ctx.tree, monitor).nodeWindow;

    // Corruption #1: an empty CON.
    createContainerNode(monitor, LAYOUT_TYPES.HSPLIT);
    // Corruption #2: a WINDOW with a child.
    const bogusChild = new Node(NODE_TYPES.WINDOW, createMockWindow());
    a.childNodes.push(bogusChild);
    bogusChild.parentNode = a;

    const rules = rulesOf(ctx.tree);
    expect(rules).toContain("empty-con");
    expect(rules).toContain("window-not-leaf");
  });
});
