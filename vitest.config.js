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
      include: ["lib/**/*.js"],
      exclude: [
        "lib/prefs/**", // Preferences UI, not testable without GTK4
        "lib/extension/cheatsheet.js", // UI-only (St/Clutter widgets)
        "lib/extension/indicator.js", // UI-only (Quick Settings panel)
        "lib/extension/extension-theme-manager.js", // UI-only (stylesheet management)
        "**/*.test.js",
        "**/mocks/**",
      ],
      all: true,
      // Regression ratchet (forge-fhen.8): set a few points below the measured
      // baseline (stmts/lines 91.98%, branches 86.62%, funcs 91.79%) so a drop in
      // coverage fails CI without an immediately-red build. Raise these as coverage
      // improves; do NOT lower them to make a red build pass.
      thresholds: {
        lines: 90,
        branches: 85,
        functions: 90,
        statements: 90,
      },
    },
  },
});
