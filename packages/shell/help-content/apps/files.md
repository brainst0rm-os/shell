# Files

Files is for any blob you'd otherwise store on your disk — PDFs, images, archives, spreadsheets, anything. Inside Brainstorm, each one becomes a [`File` entity](../concepts/entities.md) you can tag, link, search, and embed.

## The folder tree

A folder tree runs down the left side. Drag files between folders. Right-click a folder for **New folder**, **Rename**, **Delete**.

Folders here are Brainstorm folders — they live inside your vault, not on your desktop. They're independent from your OS filesystem.

## Adding files

- **Drag** from your desktop or another app into the Files window.
- Click **Upload** in the toolbar.
- Drop into another app (Notes, Whiteboard) and Brainstorm files it in `/Inbox` for you to sort later.

## Previewing

Click a file to open the preview side panel. Common types preview inline:

- **Images** — full-resolution view with zoom.
- **PDFs** — paged viewer with text selection and search.
- **Audio / video** — built-in player.
- **Text / Markdown / code** — syntax-highlighted.

Anything else gets a generic preview with **Open externally** to hand it to your OS default app.

## Tagging and properties

A file is an entity, so it carries [properties](../concepts/properties.md). Add `tags`, `project`, `status`, anything you want. Filter in the [Database app](./database.md) the same as any other entity type.

## Search

The toolbar search filters by name. The dashboard [launcher](../concepts/search.md) searches across name, captured text (for PDFs / images via OCR if enabled), and properties.

## Versioning

Brainstorm keeps the last few versions of a file when you replace it. Open the inspector → **Versions** to roll back.
