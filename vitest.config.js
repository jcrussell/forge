import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup.js"],
    include: ["tests/**/*.test.js", "lib/**/*.test.js"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["lib/**/*.js", "extension.js"],
      exclude: [
        // The prefs window is GTK4/Adw widget code; only its pure helpers run here.
        "lib/prefs/!(floating-overrides|keyboard-accel).js",
        "**/*.test.js",
        "**/mocks/**",
      ],
      all: true,
      // Regression ratchet: each floor sits a few points below the measured value
      // so a drop fails CI without an immediately-red build. The global floor
      // covers every measured file (measured 94.2 stmts/lines, 87.52 branches,
      // 93.91 funcs). The entry point and the shell UI files are small enough to
      // vanish into the global number, so each also has its own floor, 2-3 points
      // under its measured value. Raise these as coverage improves; do NOT lower
      // them to make a red build pass.
      thresholds: {
        lines: 90,
        branches: 85,
        functions: 90,
        statements: 90,
        // measured 97.22 / 82.43 / 100 / 97.22
        "extension.js": { statements: 95, branches: 80, functions: 97, lines: 95 },
        // measured 98.96 / 75.8 / 100 / 98.96
        "lib/extension/cheatsheet.js": { statements: 96, branches: 73, functions: 97, lines: 96 },
        // measured 100 / 90 / 100 / 100
        "lib/extension/indicator.js": { statements: 97, branches: 87, functions: 97, lines: 97 },
        // measured 96.66 / 92.3 / 100 / 96.66
        "lib/extension/extension-theme-manager.js": {
          statements: 94,
          branches: 90,
          functions: 97,
          lines: 94,
        },
      },
    },
  },
});
