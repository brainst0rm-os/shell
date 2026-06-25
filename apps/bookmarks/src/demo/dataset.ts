/**
 * In-memory bookmark dataset — Stage 9.18.1.5 preview drop only.
 *
 * Synthesised list spanning all three mutually-exclusive surfaces
 * (Inbox / Read / Archive) plus tag variety so the four-surface
 * renderer has something to paint on first load. Per
 * [[preview-drop-pattern]]: 9.18.2 swaps `buildBookmarksDemo()` for
 * `services.vaultEntities.list` filtered to `Bookmark/v1`; the
 * renderer's projection + surface routing stay unchanged.
 *
 * Anchor: 2026-05-14 — matches the project's stable timestamp so test
 * snapshots remain deterministic.
 */

import { normalizeTagList } from "../logic/tag-utils";
import { normalizeUrl } from "../logic/url-parse";
import type { Bookmark } from "../types/bookmark";

const ANCHOR_MS = Date.UTC(2026, 4, 14, 0, 0, 0);
const DAY = 86_400_000;

type Seed = {
	url: string;
	title: string;
	description?: string;
	tags: string[];
	savedDaysAgo: number;
	readDaysAgo?: number;
	archivedDaysAgo?: number;
	notes?: string;
	colorHint?: string | null;
};

const SEEDS: Seed[] = [
	{
		url: "https://lexical.dev/docs/intro",
		title: "Lexical — Extensible Text Editor Framework",
		description:
			"Lexical is a dependency-free text editor framework that provides best-in-class accessibility, performance and reliability.",
		tags: ["editor", "lexical", "framework"],
		savedDaysAgo: 0,
	},
	{
		url: "https://docs.yjs.dev/getting-started/a-collaborative-editor",
		title: "Building a collaborative editor with Yjs",
		description: "Step-by-step guide for setting up a multi-user editor on top of Yjs.",
		tags: ["yjs", "crdt", "collab"],
		savedDaysAgo: 1,
	},
	{
		url: "https://blockprotocol.org/spec",
		title: "Block Protocol — Specification",
		description: "The interop specification for blocks across applications.",
		tags: ["block-protocol", "spec"],
		savedDaysAgo: 2,
	},
	{
		url: "https://pixijs.com/8.x/guides/basics",
		title: "PixiJS — Guide",
		description: "Modern WebGL renderer with batched draw calls.",
		tags: ["pixi", "rendering", "graphics"],
		savedDaysAgo: 3,
		readDaysAgo: 1,
	},
	{
		url: "https://www.sqlite.org/fts5.html",
		title: "SQLite FTS5",
		description: "Full-text search virtual table; the backbone of 9.22 global search.",
		tags: ["sqlite", "fts", "search"],
		savedDaysAgo: 4,
		readDaysAgo: 2,
	},
	{
		url: "https://www.electronjs.org/docs/latest/tutorial/process-model",
		title: "Electron — process model",
		description: "Main / renderer / preload + utility processes overview.",
		tags: ["electron", "platform"],
		savedDaysAgo: 4,
		readDaysAgo: 1,
	},
	{
		url: "https://d3js.org/d3-force",
		title: "d3-force",
		description: "Force-directed graph layout primitives. Pairs cleanly with Pixi for the Graph app.",
		tags: ["d3", "graph", "rendering"],
		savedDaysAgo: 5,
		readDaysAgo: 3,
	},
	{
		url: "https://www.figma.com/blog/multiplayer-cursors/",
		title: "How Figma built multiplayer cursors",
		description: "The architectural call-outs around presence + cursor smoothing.",
		tags: ["figma", "collab", "ux"],
		savedDaysAgo: 6,
		readDaysAgo: 5,
	},
	{
		url: "https://github.com/yjs/y-protocols",
		title: "y-protocols — sync + awareness",
		description: "Wire-format docs for the sync / awareness protocols.",
		tags: ["yjs", "protocols", "sync"],
		savedDaysAgo: 8,
		readDaysAgo: 6,
	},
	{
		url: "https://www.anthropic.com/research/claude-3-5-sonnet",
		title: "Introducing Claude 3.5 Sonnet",
		description: "Capabilities + pricing of the 3.5 family.",
		tags: ["ai", "anthropic"],
		savedDaysAgo: 9,
		readDaysAgo: 7,
	},
	{
		url: "https://www.figma.com/blog/realtime-editing-of-ordered-sequences/",
		title: "Realtime editing of ordered sequences",
		description: "Fractional indexing for collaborative ordered lists.",
		tags: ["figma", "crdt", "list"],
		savedDaysAgo: 10,
		readDaysAgo: 9,
	},
	{
		url: "https://nodejs.org/api/worker_threads.html",
		title: "Node worker_threads",
		description: "Reference for the worker primitives the storage + ydoc workers use.",
		tags: ["node", "platform"],
		savedDaysAgo: 12,
	},
	{
		url: "https://www.iso.org/iso-8601-date-and-time-format.html",
		title: "ISO 8601",
		description: "Date + time format reference. Used for journal entry keys.",
		tags: ["spec", "date"],
		savedDaysAgo: 14,
		archivedDaysAgo: 5,
	},
	{
		url: "https://reactjs.org/docs/concurrent-mode-intro.html",
		title: "React concurrent mode",
		description: "Overview of concurrent rendering. Mostly historical at this point.",
		tags: ["react"],
		savedDaysAgo: 16,
		archivedDaysAgo: 10,
	},
	{
		url: "https://www.signalk.org/specification.html",
		title: "Signal K specification",
		description: "Open marine-data spec. Saved out of curiosity.",
		tags: [],
		savedDaysAgo: 18,
	},
	{
		url: "https://web.dev/articles/css-cascade-layers",
		title: "CSS cascade layers",
		description: "Native layering primitive — could replace ad-hoc `:where()` scoping.",
		tags: ["css", "platform"],
		savedDaysAgo: 21,
		readDaysAgo: 14,
	},
	{
		url: "https://hpbn.co/",
		title: "High Performance Browser Networking",
		description: "Free online edition of Ilya Grigorik's networking book.",
		tags: ["book", "networking", "performance"],
		savedDaysAgo: 24,
		archivedDaysAgo: 14,
	},
	{
		url: "https://obsidian.md/about",
		title: "Obsidian — about",
		description: "Adjacent product. Useful for studying their local-first UX choices.",
		tags: ["adjacent", "knowledge-management"],
		savedDaysAgo: 26,
		readDaysAgo: 22,
	},
	{
		url: "https://docs.tursodatabase.com/",
		title: "Turso — managed SQLite at the edge",
		description: "Sync mode could be relevant for v2's optional sync transport.",
		tags: ["sqlite", "sync"],
		savedDaysAgo: 28,
	},
	{
		url: "https://www.notion.so/help/database-views",
		title: "Notion — database views",
		description: "Adjacent product. Useful for the Database app's view-kind UX comparisons.",
		tags: ["adjacent", "database"],
		savedDaysAgo: 32,
		readDaysAgo: 25,
	},
];

export function buildBookmarksDemo(): Bookmark[] {
	const out: Bookmark[] = [];
	for (let i = 0; i < SEEDS.length; i += 1) {
		const seed = SEEDS[i];
		if (!seed) continue;
		const savedAt = ANCHOR_MS - seed.savedDaysAgo * DAY;
		const readAt = seed.readDaysAgo === undefined ? null : ANCHOR_MS - seed.readDaysAgo * DAY;
		const archivedAt =
			seed.archivedDaysAgo === undefined ? null : ANCHOR_MS - seed.archivedDaysAgo * DAY;
		const url = normalizeUrl(seed.url) ?? seed.url;
		const tags = normalizeTagList(seed.tags);
		out.push({
			id: `demo-bookmark-${i + 1}`,
			url,
			title: seed.title,
			...(seed.description === undefined ? {} : { description: seed.description }),
			icon: null,
			faviconUrl: null,
			coverImageUrl: null,
			tags,
			savedAt,
			readAt,
			archivedAt,
			...(seed.notes === undefined ? {} : { notes: seed.notes }),
			colorHint: seed.colorHint ?? null,
			createdAt: savedAt,
			updatedAt: archivedAt ?? readAt ?? savedAt,
		});
	}
	return out;
}
