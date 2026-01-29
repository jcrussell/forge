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
│       └── mockWindow.js        # Helper to create mock windows
├── unit/                        # Unit tests by module
├── integration/                 # Full workflow tests
└── regression/                  # Bug regression tests
```

## Writing Tests

Tests use [Vitest](https://vitest.dev/). GNOME APIs are mocked automatically:

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockWindow } from '../../mocks/helpers/mockWindow.js';

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

## What's Not Worth Testing

Some files have low or zero coverage intentionally:

- **`keybindings.js`** - Glue code mapping keys to `windowManager.command()`. No logic to test.
- **`indicator.js`** - GNOME Shell UI integration. Would require full Shell mocking for minimal benefit.
- **`extension-theme-manager.js`** - UI-specific theme handling.

## Troubleshooting

**Import errors** (`Cannot find module 'gi://Meta'`):
- Check that `tests/setup.js` is configured in `vitest.config.js`
- Ensure mocks are exported in `tests/mocks/gnome/index.js`

**Mock behavior doesn't match real API**:
- Update the mock in `tests/mocks/gnome/` to match actual behavior

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [GNOME JavaScript (GJS) API](https://gjs-docs.gnome.org/)
