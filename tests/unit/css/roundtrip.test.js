// Property-based, seeded round-trip tests for the stylesheet CSS engine.
//
// forge-fhen.9: the forge-y3jy / 32o3 / bhjc / r23k cluster were all silent
// data-loss bugs where parse()->stringify() dropped or mangled rules with no
// parse error, and the next prefs write persisted the truncation over the
// user's stylesheet. These tests hammer the engine with many seeded, varied
// (but in-grammar) stylesheets and assert stringify(parse(x)) is a fixed point
// under a second round trip. A regression that drops a rule breaks the fixed
// point and fails here with the reproducing seed + input.
//
// Determinism: every input is derived from a fixed BASE_SEED + index via a
// hand-rolled mulberry32 PRNG. No Date.now / Math.random anywhere, so a failure
// reproduces from its printed seed.

import { describe, it, expect } from "vitest";
import { parse, stringify } from "../../../lib/css/index.js";
import { RGBAToHexA, hexAToRGBA } from "../../../lib/shared/theme.js";

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32) + tiny helper surface.
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mkRng(seed) {
  const r = mulberry32(seed);
  const int = (n) => Math.floor(r() * n);
  const pick = (arr) => arr[int(arr.length)];
  const chance = (p) => r() < p;
  return { r, int, pick, chance };
}

// ---------------------------------------------------------------------------
// CSS-fragment generator.
//
// Everything below emits ONLY constructs lib/css/index.js parses without error
// (verified: 0 parsingErrors across the exercised seed range). The goal is to
// surface DATA LOSS on supported input, not to probe parser error handling, so
// the generator deliberately stays inside the supported grammar. In particular
// it never emits a stray ';' as the sole content of a rule body -- this parser
// treats a leading semicolon before any declaration as a parse error, which is
// out of scope for a round-trip/data-loss property.
// ---------------------------------------------------------------------------

const ELEMENTS = [
  "window",
  "div",
  "span",
  "button",
  "label",
  "box",
  "StButton",
  "StWidget",
  "panel",
];
const CLASSES = [
  "tiled",
  "split",
  "floated",
  "stacked",
  "tabbed",
  "window-tiled-color",
  "focus-hint",
  "preview",
  "a",
  "b",
  "child",
  "parent",
];
const IDS = ["main", "overview", "top-bar", "id1"];
const PSEUDO = [":hover", ":focus", ":active", ":first-child", ":last-child", ":selected"];
const COMBINATORS = [" ", " > ", " + ", " ~ "];
const PROPS = [
  "color",
  "background-color",
  "background",
  "border",
  "border-width",
  "border-color",
  "margin",
  "padding",
  "opacity",
  "width",
  "height",
  "font-size",
  "box-shadow",
  "transition",
  "-webkit-transform",
  "border-radius",
];
const NAMED = [
  "red",
  "blue",
  "white",
  "transparent",
  "black",
  "none",
  "auto",
  "solid",
  "inherit",
  "currentColor",
];

function genHexColor(g) {
  const n = g.pick([3, 6, 8]);
  const hx = "0123456789abcdef";
  let s = "#";
  for (let i = 0; i < n; i++) s += hx[g.int(16)];
  return s;
}

function genNumber(g) {
  const unit = g.pick(["px", "em", "%", "rem", "", "pt", "vh"]);
  if (g.chance(0.3)) return g.int(20) / g.pick([1, 10, 100]) + unit;
  return g.int(500) + unit;
}

function genFunc(g) {
  const kind = g.pick(["rgb", "rgba", "hsl", "url", "calc", "linear-gradient"]);
  const sep = g.chance(0.5) ? ", " : " ";
  switch (kind) {
    case "rgb":
      return `rgb(${g.int(256)}${sep}${g.int(256)}${sep}${g.int(256)})`;
    case "rgba":
      return `rgba(${g.int(256)}${sep}${g.int(256)}${sep}${g.int(256)}${sep}${g.int(100) / 100})`;
    case "hsl":
      return `hsl(${g.int(360)}, ${g.int(100)}%, ${g.int(100)}%)`;
    case "url":
      return `url(images/${g.pick(["a", "bg", "icon"])}.png)`;
    case "calc":
      return `calc(100% - ${g.int(50)}px)`;
    default:
      return `linear-gradient(to right, ${genHexColor(g)}, ${genHexColor(g)})`;
  }
}

function genValue(g) {
  const parts = [];
  const n = 1 + g.int(3);
  for (let i = 0; i < n; i++) {
    const kind = g.int(5);
    if (kind === 0) parts.push(genHexColor(g));
    else if (kind === 1) parts.push(genNumber(g));
    else if (kind === 3) parts.push(genFunc(g));
    else parts.push(g.pick(NAMED));
  }
  let v = parts.join(" ");
  if (g.chance(0.15)) v += " !important";
  return v;
}

function genSelector(g) {
  const nParts = 1 + g.int(2);
  const segs = [];
  for (let i = 0; i < nParts; i++) {
    let s;
    const t = g.int(4);
    if (t === 0) s = g.pick(ELEMENTS);
    else if (t === 1) s = "." + g.pick(CLASSES);
    else if (t === 2) s = "#" + g.pick(IDS);
    else s = g.pick(ELEMENTS) + "." + g.pick(CLASSES);
    if (g.chance(0.3)) s += g.pick(PSEUDO);
    segs.push(s);
  }
  return segs.join(g.pick(COMBINATORS));
}

function genDeclarations(g) {
  const n = g.int(5); // may be 0 -> empty rule body (forge-bhjc territory)
  const decls = [];
  for (let i = 0; i < n; i++) decls.push(`${g.pick(PROPS)}: ${genValue(g)}`);
  return decls;
}

function innerWs(g) {
  return g.chance(0.5) ? " " : g.chance(0.5) ? "\n" : "  ";
}

function genRule(g) {
  const nSel = 1 + g.int(3);
  const sels = [];
  for (let i = 0; i < nSel; i++) sels.push(genSelector(g));
  const selStr = sels.join(g.chance(0.5) ? ", " : ",\n");
  const decls = genDeclarations(g);
  // Trailing / doubled semicolons only after a real declaration -- a bare ';'
  // in an empty body is not accepted by this parser.
  const trailingSemi = decls.length && g.chance(0.3) ? ";" : "";
  const doubledSemi = decls.length && g.chance(0.15) ? ";" : "";
  const body = decls.length ? decls.join("; ") + trailingSemi + doubledSemi : "";
  return `${selStr} {${innerWs(g)}${body}${innerWs(g)}}`;
}

function genComment(g) {
  return `/* ${g.pick(["note", "TODO", "forge", "color block"])} ${g.int(100)} */`;
}

function genMedia(g) {
  const q = g.pick(["screen", "(min-width: 600px)", "print"]);
  return `@media ${q} {\n${genRule(g)}\n}`;
}

function genKeyframes(g) {
  const name = g.pick(["slide", "fade", "pulse"]);
  return `@keyframes ${name} {\n from { opacity: 0; }\n to { opacity: 1; }\n}`;
}

function genStylesheet(seed) {
  const g = mkRng(seed);
  const nBlocks = 1 + g.int(8);
  const blocks = [];
  for (let i = 0; i < nBlocks; i++) {
    const t = g.int(10);
    if (t === 0) blocks.push(genComment(g));
    else if (t === 1) blocks.push(genMedia(g));
    else if (t === 2) blocks.push(genKeyframes(g));
    else blocks.push(genRule(g));
    if (g.chance(0.3)) blocks.push(""); // blank line
    if (g.chance(0.1)) blocks.push(genComment(g));
  }
  return blocks.join(g.chance(0.5) ? "\n\n" : "\n");
}

// ---------------------------------------------------------------------------
// Recursive AST counters.
//
// The idempotence property only catches losses that leave non-idempotent
// RESIDUE -- a "clean" drop of a rule or declaration that still stringifies to
// valid, already-idempotent output slips past it. These counters are a direct
// anti-drop guard: they walk the whole tree (into @media/@supports/@host/
// @document/@keyframes bodies, and @page/@font-face declaration lists) so a
// node dropped at ANY nesting level changes the count.
// ---------------------------------------------------------------------------

// Every AST node type that carries a child rule/at-rule list.
const RULE_CONTAINERS = ["stylesheet", "media", "supports", "host", "document"];

function childRules(node) {
  if (node.type === "stylesheet") return node.stylesheet.rules;
  return node.rules || [];
}

// Count all rule/at-rule nodes across the tree (comments excluded), recursing
// into every nested block. @keyframes counts as one node here (its inner
// keyframe blocks are covered by the declaration counter below).
function countRules(node) {
  let n = 0;
  for (const child of childRules(node)) {
    if (child.type === "comment") continue;
    n += 1;
    if (RULE_CONTAINERS.includes(child.type)) n += countRules(child);
  }
  return n;
}

// Count every declaration across the tree: direct rule/@page/@font-face bodies,
// declarations nested inside @media/@supports/etc, and the declarations inside
// each @keyframes -> keyframe block.
function countDeclarations(node) {
  let n = 0;
  const decls = node.declarations || [];
  n += decls.filter((d) => d.type === "declaration").length;

  for (const child of childRules(node)) {
    if (child.type === "comment") continue;
    n += countDeclarations(child);
  }
  if (node.type === "keyframes") {
    for (const frame of node.keyframes || []) {
      if (frame.type === "keyframe") n += countDeclarations(frame);
    }
  }
  return n;
}

// ---------------------------------------------------------------------------
// Idempotence property.
// ---------------------------------------------------------------------------

const BASE_SEED = 0x5f3759df;
const SEED_COUNT = 400;

// Distinct, deterministic seeds derived from the base + index (odd multiplier
// keeps the low bits moving so mulberry32 doesn't cluster).
const SEEDS = Array.from({ length: SEED_COUNT }, (_, i) => (BASE_SEED + i * 2654435761) >>> 0);

describe("CSS parse/stringify round-trip (seeded property)", () => {
  it(`is a fixed point on the second round trip across ${SEED_COUNT} seeded stylesheets`, () => {
    for (const seed of SEEDS) {
      const x = genStylesheet(seed);

      // Sanity: the generator must stay inside the supported grammar, otherwise
      // we'd be testing parser error handling instead of data loss.
      const firstParse = parse(x, { silent: true });
      expect(
        firstParse.stylesheet.parsingErrors,
        `generator emitted out-of-grammar input for seed ${seed}:\n${x}`
      ).toHaveLength(0);

      const a = stringify(firstParse);
      const b = stringify(parse(a, { silent: true }));

      // The core property: one round trip normalizes; a second must be a no-op.
      // A dropped/mangled rule breaks this and prints the reproducing seed.
      expect(
        b,
        `round-trip not idempotent for seed ${seed}\n--- input ---\n${x}\n--- first stringify ---\n${a}\n--- second stringify ---\n${b}`
      ).toBe(a);
    }
  });

  it("preserves recursive rule and declaration counts (no silent drop at any nesting level)", () => {
    for (const seed of SEEDS) {
      const x = genStylesheet(seed);
      const ast = parse(x, { silent: true });
      const a = stringify(ast);
      const reAst = parse(a, { silent: true });

      // Rule count recurses into at-rule bodies -- a rule dropped INSIDE a
      // @media/@supports block (forge-y3jy/bhjc were exactly "a rule vanished
      // with no parse error") must change the count, not just top-level losses.
      expect(
        countRules(reAst),
        `rule count changed on round trip for seed ${seed}\n--- input ---\n${x}\n--- output ---\n${a}`
      ).toBe(countRules(ast));

      // Declaration count is the anti-drop guard idempotence can't give: a clean
      // drop of a declaration (or nested rule's declarations) leaves valid,
      // already-idempotent output, so only a direct count catches it.
      expect(
        countDeclarations(reAst),
        `declaration count changed on round trip for seed ${seed}\n--- input ---\n${x}\n--- output ---\n${a}`
      ).toBe(countDeclarations(ast));
    }
  });
});

// ---------------------------------------------------------------------------
// Color-helper round trips (RGBAToHexA / hexAToRGBA).
//
// These are pure functions exported from theme.js; the module pulls in GNOME
// imports but the vitest setup mocks them, so importing the helpers directly
// works (same as tests/unit/shared/theme.test.js).
// ---------------------------------------------------------------------------

describe("color helper round-trips (seeded)", () => {
  it("hexAToRGBA(RGBAToHexA(c)) recovers c within alpha rounding tolerance", () => {
    for (let i = 0; i < 200; i++) {
      const g = mkRng((BASE_SEED ^ 0x9e3779b9) + i * 40503);
      const r = g.int(256);
      const gc = g.int(256);
      const b = g.int(256);
      // Alpha as a 2-decimal float in [0,1]; RGBAToHexA quantizes to a byte, so
      // the recovered alpha carries ~1/255 of rounding error.
      const alpha = g.int(101) / 100;
      const input = `rgba(${r}, ${gc}, ${b}, ${alpha})`;

      const hex = RGBAToHexA(input);
      const back = hexAToRGBA(hex);
      const m = back.match(/rgba\((\d+),(\d+),(\d+),([\d.]+)\)/);
      expect(m, `unexpected rgba shape ${back} from ${input} (seed idx ${i})`).not.toBeNull();

      expect(Number(m[1]), `red drift for ${input}`).toBe(r);
      expect(Number(m[2]), `green drift for ${input}`).toBe(gc);
      expect(Number(m[3]), `blue drift for ${input}`).toBe(b);
      expect(Number(m[4]), `alpha drift for ${input}`).toBeCloseTo(alpha, 2);
    }
  });

  it("RGBAToHexA(hexAToRGBA(h)) is the identity on 8-digit hex", () => {
    for (let i = 0; i < 200; i++) {
      const g = mkRng((BASE_SEED ^ 0x85ebca6b) + i * 26557);
      const hx = "0123456789abcdef";
      let h = "#";
      // Only 8-digit (#rrggbbaa): hexAToRGBA only decodes length-5 and length-9
      // strings, so shorter hex is out of scope for this direction.
      for (let k = 0; k < 8; k++) h += hx[g.int(16)];

      const rgba = hexAToRGBA(h);
      expect(RGBAToHexA(rgba), `hex identity broke for ${h} (seed idx ${i})`).toBe(h);
    }
  });
});
