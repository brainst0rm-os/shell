# Links and mentions

Brainstorm tracks the connections between [entities](./entities.md). You make those connections two ways: by mentioning another entity inline, or by adding it as a property.

## `@` mentions

Type `@` anywhere in a [note](../apps/notes.md) and a typeahead opens. Search for the entity you want — a task, another note, a file, anyone. Hit `Enter` to insert.

A mention is a live link, not a copy of the title. If you later rename the mentioned entity, the mention text updates everywhere. Click it to jump to the entity in its app.

## Property links

Some [properties](./properties.md) hold entity references — for example, a task's `Project` property points at a project entity. These work like mentions: rename-safe, click-to-navigate.

## The link survives the rename

This is the whole point. Inside Brainstorm you never have to fix broken references — drag, copy, rename, move between vaults, the links keep working as long as the target entity exists.

## Backlinks

Every entity has a list of what mentions it. Open an entity's inspector (right side of the app window) to see incoming links. Open the [Graph app](../apps/graph.md) to see the whole network at once.

## External links

Plain web URLs — `https://…` — work like everywhere else. Type or paste one and it becomes clickable. Brainstorm doesn't treat external URLs as entities; if you want to keep one around, save it to [Bookmarks](../apps/bookmarks.md) and reference the bookmark.
