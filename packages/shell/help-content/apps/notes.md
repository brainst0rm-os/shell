# Notes

Notes is a rich-text editor for everything you'd write in a notebook — meeting notes, ideas, journals, drafts, anything long-form.

## Block-based writing

Each paragraph, heading, list, quote, image, or embed is a **block**. Hover the left margin and a `⋮⋮` handle appears — drag it to reorder, click it for the block menu.

## Slash commands

Type `/` at the start of a line to open the block menu. Filter by typing — `/h1`, `/list`, `/image`, `/code`, `/quote`. Pick a block and the line converts.

Common ones:

- `/h1`, `/h2`, `/h3` — headings.
- `/list`, `/numbered`, `/todo` — lists (bulleted, numbered, checkable).
- `/code` — a code block. Pick a language for syntax highlighting.
- `/quote`, `/divider` — quote and horizontal rule.
- `/image`, `/file` — drag to upload, or paste from clipboard.
- `/embed` — embed another [entity](../concepts/entities.md).

## Mentions and links

Type `@` and start a name to [mention](../concepts/links-and-mentions.md) another entity. Hit `Enter` to insert. The mention is live — if you rename the target later, the mention text updates.

Paste a URL and it becomes a clickable link. Paste a Brainstorm entity link and it inlines as a mention.

## Embedding

Embeds are richer than mentions — they render the target's content inline. Drop a file and it embeds as a preview. Mention a Database view and the view renders inside your note.

## Drag images and files

Drag from your desktop into a note to attach. Images preview inline; other files embed as a card with the icon, size, and a click-to-open.

## Find and replace

`Cmd+F` (macOS) or `Ctrl+F` (Windows/Linux) opens find within the current note. The find bar supports plain text and regular expressions; toggle the `.*` button. **Replace** is on the same bar.
