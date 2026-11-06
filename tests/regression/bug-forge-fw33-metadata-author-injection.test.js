import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * forge-fw33: `make metadata` turned `git shortlog` author identities into the
 * JS module lib/prefs/metadata.js with awk, escaping only `"` in names and
 * nothing in emails. An author like `e",globalThis.PWN=1,"@x` ran code in the
 * prefs process, and a name with `\"` broke the module. The target now
 * serialises with json.dumps, so every identity comes back as a literal string.
 */
const hasTools = ["git", "make", "python3"].every((tool) => {
  try {
    execFileSync("sh", ["-c", `command -v ${tool}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
});

const MAKEFILE = resolve(__dirname, "../../Makefile");

const hostile = [
  { name: "Quote", email: 'e",globalThis.PWN=1,"@x' },
  { name: 'Back\\" slash', email: "b@x" },
  { name: "Spaced", email: "has space@x" },
];

// Run git/make against the temp repo only: a pre-commit hook exports GIT_DIR,
// GIT_INDEX_FILE etc., which would point them at the repository being committed.
// Ignore the developer's git config too (commit.gpgsign, hooks).
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

describe.skipIf(!hasTools)("forge-fw33: make metadata serialises author identities", () => {
  let repo;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "forge-fw33-"));
    mkdirSync(join(repo, "lib/prefs"), { recursive: true });
    const git = (...args) => execFileSync("git", args, { cwd: repo, env, stdio: "ignore" });
    git("init", "-q");
    for (const { name, email } of hostile) {
      git(
        "-c",
        `user.name=${name}`,
        "-c",
        `user.email=${email}`,
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        name
      );
    }
    execFileSync("make", ["-s", "-f", MAKEFILE, "metadata"], { cwd: repo, env, stdio: "ignore" });
  });

  afterAll(() => {
    if (repo) rmSync(repo, { recursive: true, force: true });
    delete globalThis.PWN;
  });

  it("generates a module that parses, runs nothing, and holds each identity verbatim", async () => {
    const { developers } = await import(pathToFileURL(join(repo, "lib/prefs/metadata.js")).href);

    expect(globalThis.PWN).toBeUndefined();
    expect([...developers].sort()).toEqual(
      hostile.map(({ name, email }) => `${name} <${email}>`).sort()
    );
  });
});
