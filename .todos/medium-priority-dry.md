# Medium Priority DRY Improvements

## Keybinding Factory Function
**File:** `lib/extension/keybindings.js:190-566`

The keybinding registration code has repetitive patterns that could be consolidated into a factory function.

## Layout Processor Consolidation
**File:** `lib/extension/tree.js:1543-1693`

Multiple layout processing methods share similar logic that could be extracted.

## Minimize/Unminimize Handler Consolidation
**File:** `lib/extension/window.js:260-285`

The minimize and unminimize handlers have similar structures that could be combined.
