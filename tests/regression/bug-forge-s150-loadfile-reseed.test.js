import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConfigManager } from "../../lib/shared/settings.js";
import { File } from "../mocks/gnome/Gio.js";

/**
 * Bug forge-s150 (audit-2026-07 / C19): loadFile only seeded the profile copy when
 * the profile DIRECTORY did not exist. After any patchCss the dir persists (it holds
 * stylesheet.css.bak), so deleting just stylesheet.css left the dir present and
 * seeding was permanently skipped — stylesheetFile returned null forever (patchCss a
 * no-op, unstyled borders/tabs with no recovery).
 *
 * Fix: seed whenever the target FILE is missing (dir present or not) and return it.
 */
describe("Bug forge-s150: loadFile reseeds a deleted file even when the dir exists", () => {
  let configManager;

  beforeEach(() => {
    configManager = new ConfigManager({ dir: { get_path: () => "/test/extension" } });
  });

  afterEach(() => vi.restoreAllMocks());

  it("recreates the file from defaults when the dir already exists", () => {
    const mockStream = { write_all: vi.fn(() => [true, 0]), close: vi.fn(() => true) };
    let callCount = 0;

    vi.spyOn(File, "new_for_path").mockImplementation((path) => {
      callCount++;
      const file = new File(path);
      if (callCount === 1) {
        // The custom file itself is missing (was deleted).
        file.query_exists = vi.fn(() => false);
        file.create = vi.fn(() => mockStream);
      }
      if (callCount === 2) {
        // The profile DIR still exists (stylesheet.css.bak left it behind).
        file.query_exists = vi.fn(() => true);
        file.make_directory_with_parents = vi.fn(() => false); // must NOT be needed
      }
      return file;
    });

    const defaultFile = new File("/default/file.json");
    defaultFile.load_contents = vi.fn(() => [
      true,
      new TextEncoder().encode('{"seed": true}'),
      null,
    ]);

    const result = configManager.loadFile("/custom", "file.json", defaultFile);

    expect(mockStream.write_all).toHaveBeenCalled();
    expect(result).not.toBeNull();
  });
});
