# Tasks

Tasks tracks the things you need to do. Each task is one [entity](../concepts/entities.md) with a status, an optional due date, an optional project, and any other [properties](../concepts/properties.md) you've added.

## Surfaces

The left sidebar has four built-in surfaces:

- **Inbox** — tasks without a project. Triage them from here.
- **Today** — anything due today plus anything overdue.
- **Upcoming** — the next seven days.
- **Projects** — your projects, each with its own task list.

Click a surface to focus the main pane on its tasks.

## Creating a task

Click **New task** or press `N`. Type the title. Press `Tab` to set due date with a natural-language input (`tomorrow`, `next mon`, `25 dec`). Press `Enter` to save.

You can capture from anywhere with the global shortcut — **Settings → Keyboard** has the binding.

## Properties

Each task has:

- **Status** — Todo / Doing / Done by default. Customise the dictionary in **Settings → Data → Dictionaries**.
- **Due** — date or date-and-time.
- **Project** — links to a project entity. Tasks group by project in views.
- **Priority** — Low / Medium / High / Urgent.

Add your own properties (estimate, energy, context, anything) the same way you would on any entity.

## Recurrence

Set a task to repeat — daily, weekly on specific days, monthly on a date or weekday, yearly, or with a custom rule. When you mark a recurring task done, the next occurrence is generated automatically.

## Views

The main pane defaults to a list grouped by date. Switch to **Board** to see kanban columns by status, or **Calendar** to see tasks placed on their due dates. Filtering and grouping work the same way as in the [Database app](./database.md).
