import { describe, it, expect } from "vitest";
import { ESLint } from "eslint";

// eslint.config.js bans connectObject/disconnectObject where prefs loads the
// code: signalTracker.js only patches GObject.Object in the shell process.
const eslint = new ESLint();

async function messages(code, filePath) {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((m) => m.ruleId === "no-restricted-syntax");
}

const CALLS = "obj.connectObject('changed', cb, this);\nobj.disconnectObject(this);\n";

describe("eslint.config.js: connectObject outside the shell process", () => {
  it.each(["lib/prefs/settings.js", "prefs.js", "lib/shared/config-sync.js"])(
    "flags connectObject and disconnectObject in %s",
    async (filePath) => {
      const found = await messages(CALLS, filePath);
      expect(found).toHaveLength(2);
      expect(found[0].message).toMatch(/only in the shell process/);
    }
  );

  it("still flags GNOME 51 removed API in those files", async () => {
    const found = await messages("box.set_vertical(true);\n", "lib/shared/config-sync.js");
    expect(found).toHaveLength(1);
  });

  it("allows them in the extension's shell-side code", async () => {
    expect(await messages(CALLS, "lib/extension/window.js")).toEqual([]);
  });
});
