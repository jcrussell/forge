import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * release-notes.sh groups subjects by type: feat, fix and docs/i18n get their own
 * sections, any other type is Maintenance, and a subject with no type is Other.
 * It lists contributors from commit authors and Co-authored-by
 * trailers, dropping AI co-authors and bots. Names are untrusted text in a
 * Markdown release body (forge-fw33 treats them the same way in the build), so
 * a plain name must render literally: no links, images, HTML or @mentions, and
 * a name never borrows a login another commit resolved to. Handles come from
 * GitHub's GraphQL Commit.authors, faked here by a stub `gh`.
 */
const hasTools = ["git", "jq"].every((tool) => {
  try {
    execFileSync("sh", ["-c", `command -v ${tool}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
});

const SCRIPT = resolve(__dirname, "../../.github/scripts/release-notes.sh");

// Same isolation as the forge-fw33 test: ignore hook-exported GIT_* and the
// developer's git config. GH_TOKEN/GITHUB_TOKEN are cleared so only the stub
// decides whether a GitHub login is available.
const baseEnv = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.startsWith("GIT_") && key !== "GH_TOKEN" && key !== "GITHUB_TOKEN"
    )
  ),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GITHUB_REPOSITORY: "owner/repo",
};

// Stub gh: `auth status` succeeds when STUB_AUTH is set. `api graphql` answers
// from $STUB_DIR/<sha>.json (the commit's authors.nodes); a sha with no file is
// a commit GitHub doesn't have (null). The real --jq expression is applied.
const STUB = `#!/usr/bin/env bash
[ "$1" = auth ] && { [ -n "\${STUB_AUTH:-}" ]; exit; }
[ -n "\${STUB_FAIL:-}" ] && exit 1
for a; do case "\${prev:-}" in -f) q="\${a#query=}";; --jq) jqx="$a";; esac; prev="$a"; done
sep=
{ printf '{"data":{"repository":{'
  for sha in $(grep -oE 'c[0-9a-f]{40}:' <<<"$q" | sed 's/^c//; s/:$//'); do
    f="$STUB_DIR/$sha.json"
    if [ -f "$f" ]; then printf '%s"c%s":{"authors":{"nodes":%s}}' "$sep" "$sha" "$(cat "$f")"
    else printf '%s"c%s":null' "$sep" "$sha"; fi
    sep=,
  done
  printf '}}}'; } | jq -r "$jqx"
`;

describe.skipIf(!hasTools)("release-notes.sh", () => {
  let repo, bin, stubDir;
  const shas = {};

  const run = (extraEnv = {}) =>
    execFileSync(SCRIPT, ["HEAD", "v1"], {
      cwd: repo,
      env: { ...baseEnv, PATH: `${bin}:${process.env.PATH}`, STUB_DIR: stubDir, ...extraEnv },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

  const contributors = (notes) =>
    notes.split("### Contributors\n\n")[1].split("\n\n")[0].split("\n");

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "forge-relnotes-"));
    bin = join(repo, ".bin");
    stubDir = join(repo, ".stub");
    mkdirSync(bin);
    mkdirSync(stubDir);
    writeFileSync(join(bin, "gh"), STUB);
    chmodSync(join(bin, "gh"), 0o755);

    const git = (...args) =>
      execFileSync("git", args, { cwd: repo, env: baseEnv, encoding: "utf8" }).trim();
    const commit = (key, name, email, message) => {
      git(
        "-c",
        `user.name=${name}`,
        "-c",
        `user.email=${email}`,
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        message
      );
      shas[key] = git("rev-parse", "HEAD");
    };
    git("init", "-q");
    commit("base", "Before Range", "before@x", "chore: before the range");
    git("tag", "v1");
    commit("alice", "Alice Example", "alice@x", "fix: one");
    commit("alice2", "Alice Example", "alice@work.x", "fix: two");
    commit(
      "coauth",
      "Maintainer",
      "m@x",
      "feat: reimplemented\n\nCo-authored-by: Carol Contributor <carol@x>\nCo-authored-by: [y](https://evil.example) #1 <t@x>\nCo-Authored-By: Claude Opus <noreply@anthropic.com>"
    );
    commit("imposter", "Carol Contributor", "imposter@x", "fix: four");
    commit("lower", "alice", "lower@x", "fix: five");
    commit("botname", "Robo [bot] Fan", "fan@x", "fix: six");
    commit("revert", "Alice Example", "alice@x", "revert(tree): undo the walk");
    commit("i18n", "Alice Example", "alice@x", "i18n: new strings");
    commit("plain", "Alice Example", "alice@x", "Plain subject: no type");
    commit(
      "bot",
      "dependabot[bot]",
      "49699333+dependabot[bot]@users.noreply.github.com",
      "build: bump"
    );
    commit(
      "hostile",
      "[x](https://evil.example) ![i](https://evil.example/i.png) @victim <b>hi</b> &amp; *em*",
      "h@x",
      "fix: three"
    );
  });

  afterAll(() => {
    if (repo) rmSync(repo, { recursive: true, force: true });
  });

  it("lists docs/i18n with docs, any other type under Maintenance, and no type under Other", () => {
    const notes = run();
    const sectionOf = (heading) => notes.split(heading)[1].split(/\n(###|<details>|\*\*Full)/)[0];
    expect(sectionOf("### Documentation & Translations")).toContain("- new strings");
    expect(sectionOf("<b>Maintenance</b>")).toMatch(
      /- undo the walk\n[^]*- bump|- bump\n[^]*- undo the walk/
    );
    expect(sectionOf("<b>Other</b>")).toContain("- Plain subject: no type");
    expect(sectionOf("<b>Other</b>")).not.toMatch(/new strings|undo the walk/);
  });

  it("without a GitHub login, lists authors and co-authors by name, minus AI and bots", () => {
    const list = contributors(run());
    expect(list).toContain("- Alice Example");
    expect(list).toContain("- Carol Contributor");
    expect(list).toContain("- Maintainer");
    expect(list.filter((l) => l === "- Alice Example")).toHaveLength(1);
    expect(list).toContain("- Robo \\[bot\\] Fan"); // a human, not a bot account
    expect(list.join("\n")).not.toMatch(/Claude|dependabot|Before Range/);
  });

  it("escapes plain names, from authors and trailers, so they render literally", () => {
    const hostile = contributors(run()).filter((l) => l.includes("evil"));
    expect(hostile).toHaveLength(2);
    for (const line of hostile) {
      const name = line.slice(2);
      // Every ASCII punctuation character is preceded by a backslash.
      expect(name.replace(/\\[!-/:-@[-`{-~]/g, "")).not.toMatch(/[!-/:-@[-`{-~]/);
    }
  });

  it("uses GitHub logins where resolved, and git names for commits GitHub lacks", () => {
    const node = (name, email, login) => ({ name, email, user: login ? { login } : null });
    writeFileSync(
      join(stubDir, `${shas.alice}.json`),
      JSON.stringify([node("Alice Example", "alice@x", "alice")])
    );
    // alice2 has no file: GitHub doesn't have it, so it falls back to git; the
    // name already resolved to @alice elsewhere in the range is reused.
    writeFileSync(
      join(stubDir, `${shas.coauth}.json`),
      JSON.stringify([
        node("Maintainer", "m@x", "maint"),
        node("Carol Contributor", "carol@x", null),
        node("Claude Opus", "noreply@anthropic.com", null),
      ])
    );
    // Someone committing under Carol's name resolves to their own account.
    writeFileSync(
      join(stubDir, `${shas.imposter}.json`),
      JSON.stringify([node("Carol Contributor", "imposter@x", "imposter")])
    );
    const list = contributors(run({ STUB_AUTH: "1" }));
    expect(list).toContain("- @alice");
    expect(list).toContain("- @maint");
    expect(list).toContain("- @imposter");
    // A name never borrows a login resolved for another commit or identity.
    expect(list).toContain("- Carol Contributor");
    expect(list).toContain("- Alice Example");
    expect(list).toContain("- alice");
    expect(list.join("\n")).not.toMatch(/Claude/);
  });

  it("falls back to names, with a warning, when the lookup fails", () => {
    const notes = run({ STUB_AUTH: "1", STUB_FAIL: "1" });
    expect(contributors(notes)).toContain("- Alice Example");
  });
});
