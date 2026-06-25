# Apps

An **app** in Brainstorm is a self-contained tool — Notes, Tasks, Files, Calendar, and so on. Each one handles a particular shape of work, but they all share your vault.

## They speak a common language

Notes doesn't know what Tasks is. Tasks doesn't know about Files. But because every app stores its work as [entities](./entities.md) of typed properties, they can read each other's data without coordination.

That's why you can:

- Drop a file from **Files** into a note.
- `@`-mention a task inside a note and have it [link](./links-and-mentions.md) two-ways.
- See every entity that references a project in the [Graph](../apps/graph.md).
- Build a [Database](../apps/database.md) view that lists every note tagged with a particular dictionary entry, regardless of which app created the note.

## They run sandboxed

Each app runs in its own isolated process. It can only access the parts of your vault you've granted it. When you install an app it declares what permissions it needs ("read your notes", "use the network"). You can review and revoke those any time in **Settings → Apps**.

This means an app can't snoop on another app's data unless you explicitly grant it that access. It also means a buggy or malicious app can't break out and read your filesystem.

## First-party vs third-party

The apps that ship with Brainstorm are written and signed by us. Anything installed from the Marketplace by another developer is third-party — the same sandbox rules apply, but always check what an unfamiliar app is asking for before you install. See [Privacy and security](../privacy-and-security.md).
