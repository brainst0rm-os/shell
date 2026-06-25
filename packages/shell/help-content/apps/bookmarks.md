# Bookmarks

Bookmarks saves web pages as [entities](../concepts/entities.md) — title, URL, captured preview, and the readable text — so you can search them, tag them, and link to them from notes.

## Saving a page

Three ways:

- **Paste** a URL into the Bookmarks window or into the dashboard launcher and pick **Save as bookmark**.
- **Drop** a URL onto the Bookmarks dock icon.
- **Right-click** a link in [Notes](./notes.md) → **Save as bookmark**.

Brainstorm fetches the page, extracts the title, the social-media preview image (OG image), and the article text. All of this is stored locally — the bookmark works offline once captured.

## What's captured

- **Title** — the page's HTML title, cleaned up.
- **URL** — the canonical URL if the page declares one, otherwise the URL you saved.
- **Preview image** — the OG image if present, falling back to the first image in the article.
- **Readable text** — the article body, stripped of navigation, ads, comments, and other chrome.

The readable text is searchable from the [launcher](../concepts/search.md). Searching "kubernetes" finds every bookmark whose article body mentions it.

## Tagging

A bookmark is an entity with [properties](../concepts/properties.md). The defaults are `title`, `url`, `tags`, `read`, `archived`. Add your own — `priority`, `topic`, `for-project`, anything.

## Views

The main window shows your bookmarks as a list with the preview image, title, source domain, and tags. Switch to **Gallery** for a card layout, or **List** for compact density.

Filter by tag, by domain, by whether you've read it, by date. The [Database app](./database.md) gives you the full filter set.

## Re-fetching

If a page changed and you want to update the captured copy, right-click the bookmark and choose **Refresh capture**. The new version replaces the old; the entity, its tags, and any mentions to it survive untouched.
