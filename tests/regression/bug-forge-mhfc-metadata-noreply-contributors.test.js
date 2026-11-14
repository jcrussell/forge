import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * forge-mhfc: `make metadata` dropped every author whose shortlog line matched
 * "noreply", so contributors committing as ID+login@users.noreply.github.com
 * were missing from the About dialog. It now drops only what release-notes.sh
 * drops: noreply@anthropic.com and [bot] identities.
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

const kept = { name: "Alice", email: "123+alice@users.noreply.github.com" };
const authors = [
  kept,
  { name: "Claude", email: "noreply@anthropic.com" },
  { name: "dependabot[bot]", email: "49699333+dependabot[bot]@users.noreply.github.com" },
];

// Run git/make against the temp repo only (see forge-fw33's test).
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

describe.skipIf(!hasTools)("forge-mhfc: make metadata keeps GitHub-noreply contributors", () => {
  let repo;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "forge-mhfc-"));
    mkdirSync(join(repo, "lib/prefs"), { recursive: true });
    const git = (...args) => execFileSync("git", args, { cwd: repo, env, stdio: "ignore" });
    git("init", "-q");
    for (const { name, email } of authors) {
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
  });

  it("lists the GitHub-noreply author and drops Claude and bots", async () => {
    const { developers } = await import(pathToFileURL(join(repo, "lib/prefs/metadata.js")).href);

    expect([...developers]).toEqual([`${kept.name} <${kept.email}>`]);
  });
});
