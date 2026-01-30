# Larger Refactors (SOLID Principles)

## Command Pattern for CommandHandler
**File:** `lib/extension/command.js:56-457`

The switch statement handling different actions could be refactored to use the Command pattern with individual command classes.

## Extract Managers from WindowManager
**File:** `lib/extension/window.js` (3072 lines)

WindowManager is too large and handles multiple responsibilities. Consider extracting:
- Focus management
- Grab operations
- Signal handling
- Decoration management

## Simplify moveWindowToPointer()
**File:** `lib/extension/window.js:1990-2400`

This method is overly complex and should be broken into smaller, more focused functions.
