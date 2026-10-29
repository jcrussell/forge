# Forge Extension Testing Infrastructure

Unit tests for the Forge GNOME Shell extension using Vitest with mocked GNOME APIs.

## Quick Start

```bash
# Run all tests in Docker (preferred)
make unit-test-docker

# Run with coverage report
make unit-test-docker-coverage

# Watch mode for development
make unit-test-docker-watch

# Or run locally if Node.js environment matches
npm test
npm run test:coverage
```

## Structure

```
tests/
├── setup.js                     # Global test setup (mocks GNOME APIs)
├── mocks/
│   ├── gnome/                   # GNOME API mocks (Meta, Gio, GLib, etc.)
│   └── helpers/
│       ├── index.js             # Central export for all test helpers
│       ├── mockWindow.js        # Helper to create mock windows
│       ├── treeHelpers.js       # Tree navigation and creation helpers
│       └── testFixtures.js      # Complete test fixture factories
├── unit/                        # Unit tests by module
├── integration/                 # Full workflow tests
└── regression/                  # Bug regression tests
```

## Writing Tests

Tests use [Vitest](https://vitest.dev/). GNOME APIs are mocked automatically:

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockWindow, createWindowManagerFixture } from '../../mocks/helpers/index.js';

describe('someFunction', () => {
  it('should do something', () => {
    const window = createMockWindow({ wm_class: 'Firefox' });
    // Test logic here
    expect(result).toBe(expected);
  });
});
```

### Test File Conventions

- Test files: `*.test.js`
- Location: `tests/unit/<module>/` or `tests/regression/`
- Naming: Match the file being tested (e.g., `utils.js` -> `utils.test.js`)

## Mock Infrastructure

The mocks simulate GNOME Shell APIs so tests run in Node.js without GNOME Shell:

| Mock | APIs |
|------|------|
| `Meta.js` | Window, Rectangle, Workspace, GrabOp |
| `Gio.js` | File, Settings |
| `GLib.js` | Path utilities, timeouts |
| `GObject.js` | Type system, signals |
| `Shell.js` | Shell integration |
| `St.js` | Shell toolkit (Bin, Widget, Label) |
| `Clutter.js` | Event handling |

Global mocks available: `global.display`, `global.get_pointer()`, `global.stage`.

### Expanding Mocks

When tests need missing functionality, add it to the appropriate mock file. Keep mocks minimal - only implement what tests actually use.

### Version-gated behaviour

The suite runs as GNOME 47 (`PACKAGE_VERSION` in `tests/setup.js`), so the
`Compat` shims take their 47 branch. A test of an API that GNOME 47 lacks is
vacuous: it exercises code that never runs there (how Forge's call to a
`get_size_hints()` that no Mutter has went unnoticed).

- **One version-specific assertion:** `vi.resetModules()`, `vi.doMock` the
  `resource:///org/gnome/shell/misc/config.js` module with the version, dynamically
  `import()` the module under test, and `vi.doUnmock` + `vi.resetModules()` in
  `finally` (see the GNOME 51 case in `tests/unit/tree/Tree-layout.test.js`).
- **A whole file that needs a newer API** (e.g. window minimum sizes, Mutter 50+):
  a file-level `vi.mock("resource:///org/gnome/shell/misc/config.js", () => ({
  PACKAGE_VERSION: "50.0" }))`, which replaces the setup default for that file
  (see `tests/regression/bug-s6g-minsize-redistribution.test.js`).

## What's Excluded From Coverage

Coverage measures `lib/**/*.js`. The `coverage.exclude` list in `vitest.config.js` drops
four source paths, all UI-only — they would need a full St/Clutter or GTK4 stack mocked
for little benefit:

- **`lib/prefs/**`** - Preferences UI, not testable without GTK4.
- **`lib/extension/cheatsheet.js`** - St/Clutter overlay widgets.
- **`lib/extension/indicator.js`** - Quick Settings panel integration.
- **`lib/extension/extension-theme-manager.js`** - stylesheet management.

(The list also carries `**/*.test.js` and `**/mocks/**`, which keep the test code itself
out of the report.)

Everything else is expected to be covered. `keybindings.js` in particular IS tested
(`tests/unit/keybindings/`, 52 tests) — its drag-modifier and dispatch logic is real
logic; only the `Main.wm` registration glue is inherently untestable.

## Troubleshooting

**Import errors** (`Cannot find module 'gi://Meta'`):
- Check that `tests/setup.js` is configured in `vitest.config.js`
- Ensure mocks are exported in `tests/mocks/gnome/index.js`

**Mock behavior doesn't match real API**:
- Update the mock in `tests/mocks/gnome/` to match actual behavior

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [GNOME JavaScript (GJS) API](https://gjs-docs.gnome.org/)
