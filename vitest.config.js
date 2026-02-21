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
    },
  },
});
