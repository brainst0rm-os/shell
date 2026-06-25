# Whiteboard

Whiteboard is an infinite canvas for thinking visually — sketches, diagrams, sticky notes, embedded [entities](../concepts/entities.md), arrows between them.

## Tools

The toolbar runs along the top:

- **Select** — pick and move things.
- **Sticky note** — a coloured square with text. Drag to size.
- **Text** — a plain text label.
- **Shape** — rectangle, ellipse, arrow, line, polygon.
- **Pen** — freehand drawing with pressure (if your input supports it).
- **Connector** — an arrow that snaps between shapes and stays connected as you move them.
- **Embed** — drop in any entity. The whiteboard renders a live card with the entity's icon, title, and a preview.

`V` / `S` / `T` / `R` / `P` / `C` / `E` switch tools.

## Navigation

- **Drag** the canvas to pan, or use the space-bar.
- **Scroll** to zoom; `Cmd/Ctrl + scroll` for finer steps.
- `Z` then click to zoom into a region.
- `F` to fit everything on screen.

## Boards are entities

Each whiteboard is one entity. Pin it to the dashboard, link to it from a note, mention it from anywhere. Have one whiteboard per project, or one massive workspace — both work.

## Embedding live entities

Drag any entity onto the canvas. The card stays live — editing the note from inside the whiteboard updates the underlying entity. Renaming the entity updates the card title. Deleting the entity turns the card into a placeholder.

## Connectors

Drag from one shape's edge to another to draw a connector. The connector follows both shapes as you move them. Label connectors by selecting one and typing.

## Locking

Select something and press `L` to lock it. Locked items can't be moved or resized by accident. Press `L` again to unlock.

## Export

**File → Export** for PNG, SVG, or PDF. The export captures the visible canvas; zoom out to fit-all first if you want the whole board.
