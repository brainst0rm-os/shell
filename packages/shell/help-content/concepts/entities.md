# Entities

An **entity** is one thing in your vault — a note, a task, a file, a calendar event, a bookmark, a person. Apps create entities; the rest of Brainstorm reads them.

Every entity has three parts:

- A **type** — `Note`, `Task`, `File`, `Bookmark`, and so on. The type controls what shape the entity has.
- **Properties** — typed metadata. A task has a status and a due date; a bookmark has a URL and a title; a file has a size and a mime type. See [Properties](./properties.md).
- A **body** (optional) — the long-form content. A note's body is its rich text. A bookmark's body is the captured page text. A task has no body.

## Renaming, deleting, restoring

Right-click any entity for **Rename**, **Delete**, **Duplicate**, **Pin to dashboard**, and other actions. The same menu shows up in every app — it's the same entity underneath.

Deleted entities go to the **Bin**. They sit there until you empty it, so a delete you regret is recoverable. Open the Bin from the dashboard header.

## Cross-app reach

Because the type and properties are stable, any app can read any entity. The [Database](../apps/database.md) can show you a grid of every entity matching a filter — Notes from this week, Files over 10 MB, Tasks due tomorrow. The [Graph](../apps/graph.md) draws the network of [links and mentions](./links-and-mentions.md) between them.

## Defining your own types

You're not stuck with the built-in types. In **Settings → Data** you can define new entity types — a `Recipe`, a `Book`, a `Habit` — with their own properties. Apps that work on generic entities (Database, Graph, Files) pick them up automatically.
