# Keyboard shortcuts

Brainstorm is meant to be driven from the keyboard. Every action has a shortcut, and you can rebind any of them.

## The cheatsheet

Press `Shift+?` from anywhere to open the cheatsheet. It lists every shortcut available in your current context — global ones, plus whatever the focused app has registered.

Filter the cheatsheet by typing. Click any binding to jump to the action.

## A few essentials

- `Cmd+Space` / `Ctrl+Space` — open the [launcher](concepts/search.md).
- `Cmd+,` / `Ctrl+,` — open Settings.
- `Cmd+K` / `Ctrl+K` — global command palette.
- `Cmd+F` / `Ctrl+F` — find within the current view.
- `Cmd+W` / `Ctrl+W` — close window.
- `Cmd+T` / `Ctrl+T` — new note (in Notes), new task (in Tasks), etc.
- `Shift+?` — open the cheatsheet.
- `Esc` — close the front-most popover / dialog.

These are defaults. The cheatsheet shows what they actually are on your system right now.

## Rebinding

Open **Settings → Keyboard**. Each shortcut is one row. Click a row to record a new chord — press the keys you want and hit `Enter`. **Reset** restores the default.

Bindings travel with your [vault](concepts/vaults.md). Rebind once and your shortcuts follow you to every paired device.

## Chords

A shortcut can be a single key, a modifier-plus-key, or a **chord** — two presses in sequence. `Cmd+K Cmd+R` first presses `Cmd+K`, then `Cmd+R` while still holding `Cmd`. Use chords when you want a memorable namespace ("`Cmd+K` for commands, `Cmd+K Cmd+R` for the reload action").

## Per-app shortcuts

Each app adds its own shortcuts on top of the shell ones. They only fire while that app is focused. The cheatsheet shows them grouped by app.

## Conflicts

If two shortcuts collide, the more-specific one wins — an app's `Cmd+B` overrides the shell's `Cmd+B` while the app has focus. **Settings → Keyboard** flags conflicts in red so you can resolve them.
