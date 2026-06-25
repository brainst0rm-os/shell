# Calendar

Calendar shows time-bound entities — events, due tasks, scheduled notes — on a grid.

## Views

The view picker in the toolbar switches between:

- **Month** — six-week grid. Best for planning.
- **Week** — seven days, hour-by-hour. Best for a workweek.
- **Day** — one day, hour-by-hour. Best for a packed day.
- **Agenda** — a chronological list. Best on small screens.

`T` jumps to today; `←` / `→` step by view-period; `J` / `K` step by day.

## What shows up

Calendar reads anything with a date or date-range [property](../concepts/properties.md):

- **Events** — entities of type `Event` with a `start` and optional `end`.
- **Tasks** — entities with a `due` date. [Tasks](./tasks.md) shows these too.
- **Anything else** — custom entity types you've defined with a date property show up automatically.

Filter from the toolbar to hide categories you don't want.

## Creating

Click an empty slot to create an event at that time. Drag across multiple slots for a duration. The new event's defaults come from the calendar's preferences (default duration, default colour).

## Editing

- **Drag** to reschedule.
- **Resize** the bottom edge to change duration.
- **Right-click** for delete / duplicate / move-to-other-day.

## All-day vs timed

Events without a time are all-day events; they sit at the top of the day column. Drag one into the timed area to give it a time.

## Linking to other entities

Open an event's inspector to add properties or [`@`-mention](../concepts/links-and-mentions.md) related notes, tasks, or files. Click a mention to jump.
