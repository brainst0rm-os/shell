# Database

Database is for working with sets of [entities](../concepts/entities.md) — tabular views, filters, grouping, batch edits. Think "a spreadsheet over anything in your vault".

## A view is a layout over a source

Every Database **view** has two halves:

- A **source** — what entities to show. A [collection](../concepts/collections.md), a type ("all tasks"), or a filter ("all notes tagged `idea`").
- A **layout** — how to show them. One of six kinds.

## The six layout kinds

- **Grid** — rows and columns. Like a spreadsheet. Edit cells in place.
- **List** — one entity per row, with a leading icon. Compact, scannable.
- **Gallery** — cards with a hero image and a few properties. Good for visual content.
- **Board** — kanban columns. Group by a `select` property (status, priority).
- **Calendar** — entities placed on a date property. Switch between month / week / day.
- **Timeline** — entities placed on a date or date-range. Zoomable horizontal axis.

Switch layouts from the view picker in the toolbar. The same data renders five other ways.

## Filtering, sorting, grouping

Open the **Filter** menu in the toolbar to chain conditions: "status is not Done **and** priority is High **or** assignee is me". Combine `and` / `or` freely.

**Sort** by any property, ascending or descending. Multi-key sort breaks ties.

**Group** by any property to collapse the view into sections.

Filters, sort, and grouping save with the view — they're the view, not transient state.

## Saving and sharing views

A view is itself an entity. Pin it to the dashboard, link to it from a note, drop it on a whiteboard. Make a "My week" view that filters tasks due in the next seven days plus events in [Calendar](./calendar.md), pin it, and your weekly planning surface is one click away.

## Embedding a view

Inside a note, type `/embed` and pick a Database view. The view renders inline. Editing the underlying view (sort, filter, columns) updates the embed.
