# Journal

Journal gives you one [note](./notes.md) per day, automatically. Open the app and today's entry is waiting — already created if it didn't exist yet.

## Navigating

- `←` / `→` — previous / next day.
- `Cmd+J` (macOS) / `Ctrl+J` (Windows/Linux) — jump to today.
- Click the date header for a calendar picker.

The sidebar shows recent entries with their first-line preview. Click any entry to jump.

## Writing

The body is a full Notes editor — slash commands, [`@`-mentions](../concepts/links-and-mentions.md), embeds, the works. See [Notes](./notes.md) for the editor reference.

## Templates

A daily template fills in section headings, prompts, or property defaults when a new entry is created. Set it up in **Settings → Journal → Template**.

Examples:

- A two-section "Morning / Evening" layout.
- A "What went well / what didn't / one thing" prompt.
- Auto-mentions of today's meetings (pulled from [Calendar](./calendar.md)).

If you don't configure a template, new entries are blank — write whatever you want.

## Properties on a journal entry

A journal entry is an [entity](../concepts/entities.md) of type `JournalEntry`. It carries the date as a property; add anything else — `mood`, `energy`, `weather`, `gratitude`, `weight`. The [Database app](./database.md) can chart those values over time.

## Backfill and forward-date

Want to journal about yesterday? Navigate back and write. Want to leave a note for next Monday? Navigate forward and write. There's no rule that says today's entry has to be written today.
