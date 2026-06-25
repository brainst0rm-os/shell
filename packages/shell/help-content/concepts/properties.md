# Properties

A **property** is typed metadata on an [entity](./entities.md). A task has `status`, `due`, `priority`, `project`. A bookmark has `url`, `title`, `tags`. A note has `created`, `updated`, and whatever else you've added.

## What types are there

The built-in types cover most needs:

- **Text** — plain or formatted (URL, email, phone).
- **Number** — integer, decimal, currency, percent.
- **Boolean** — yes/no, checked/unchecked.
- **Date** — date, date + time, range.
- **Select** — one value from a [dictionary](./properties.md#dictionaries).
- **Multi-select** — many values from a dictionary.
- **Entity reference** — link to another entity (a project, a person, a file).
- **Rich text** — a small body inside a property (notes-on-a-task).

You don't pick a flat list of "kinds" — you pick a base type and add modifiers. URL is **text** with a `URL format`. A status field is **text** with a `vocabulary` of `Todo / Doing / Done` and `single value`.

## Define your own

Open **Settings → Data → Entity types**, pick the type you want to extend (or create a new one), and add the property. Every entity of that type gets the new field. Existing entities show it as empty until you fill it in.

## Dictionaries

A **dictionary** is a reusable list of choices — `Status: Todo / Doing / Done`, `Priority: Low / Medium / High / Urgent`. Each entry can have a label, a colour, and a sort order. Multiple properties on different entity types can share a dictionary: your `Task.priority` and `Bug.severity` can use the same dictionary.

Manage dictionaries in **Settings → Data → Dictionaries**. Renaming an entry updates it everywhere it's used.

## Filtering and grouping

Once you have properties, the [Database app](../apps/database.md) lets you filter and group on them. "Tasks where priority is High and status is not Done", "Files grouped by mime type, sorted by size".
