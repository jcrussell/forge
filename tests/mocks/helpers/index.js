/**
 * Test helpers index
 *
 * Central export for all test helper modules.
 */

// Mock window factory
export * from "./mockWindow.js";

// Finalized-window modeling (faithful "already deallocated" wrapper)
export * from "./finalizeWindow.js";

// Finalized-actor modeling (faithful "already deallocated" St actor)
export * from "./finalizeActor.js";

// Signal mixin for mock objects
export * from "./signalMixin.js";

// GNOME global setup
export * from "./globalSetup.js";

// Complete test fixtures
export * from "./testFixtures.js";

// Tree navigation and creation helpers
export * from "./treeHelpers.js";
