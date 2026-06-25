# Graph

Graph visualises the network of [links](../concepts/links-and-mentions.md) between your [entities](../concepts/entities.md). Each node is one entity; each edge is a link or mention.

## Three view modes

- **Full** — every entity, every link. Useful for a bird's-eye sense of your vault.
- **Local** — focus on one entity and its neighbours, with adjustable hop depth. Drill into a project's surroundings.
- **Path** — pick two entities, see the chain of links connecting them.

Switch from the mode picker in the toolbar.

## Pattern filters

Plain filtering ("only show notes") is in the toolbar. **Patterns** are richer — they ask for a structural shape.

Examples:

- "Notes that mention a task that's still open" — a two-hop pattern across types.
- "Files linked from a note that's pinned to the dashboard" — a three-hop chain.
- "Entities that link to the same target as `Project-X`" — a sibling pattern.

Patterns are saved per-graph-view and shared with the [Database app](./database.md) — a pattern is a kind of source, just like a collection or a filter.

## Navigation

- **Drag** the canvas to pan; scroll to zoom.
- **Click** a node to focus it. **Double-click** to open the entity in its app.
- **Right-click** for the entity menu (pin, rename, delete, etc.) — the same one you see everywhere.
- **Hover** an edge to see what kind of link it is (mention, property reference).

## Layout

Nodes self-arrange by a force simulation — connected nodes pull together, unrelated ones drift apart. Drag a node to anchor it; right-click → **Free** to let it float again.

## Time travel

The **history** slider replays your vault's connection graph back through time. Slide left to see what your network looked like a month ago. Useful for "where did this idea come from?".
