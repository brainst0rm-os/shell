/**
 * Demo dataset for the 9.20.1.5 preview drop. Six synthetic files spanning
 * image / markdown / text — enough to drive the slideshow nav and to
 * exercise every renderer the drop ships. Anchored at 2026-05-14 so
 * snapshots stay deterministic.
 *
 * Replaced wholesale once the entities-service (Stage 9.3) lands and
 * Files emits real handles into `intent.open` payloads. The renderers,
 * the registry, `previewKindFor`, the inspector, and the slideshow
 * chrome all stay — only this file deletes.
 */

import { type PreviewContext, PreviewContextKind } from "../types/preview-context";
import type { PreviewFileInfo, PreviewSource } from "../types/preview-module";

export type PreviewFile = {
	readonly id: string;
	readonly info: PreviewFileInfo;
	readonly source: PreviewSource;
};

/** A simulated source context — the same shape `intent.open` payloads
 *  carry in production. Used to demo the gallery + "From: …" chip in
 *  the standalone preview-drop before the Files / Notes wiring lands. */
export type DemoContext = {
	readonly context: PreviewContext;
	readonly siblings: ReadonlyArray<PreviewFile>;
};

/** Anchor — 2026-05-14 — every entry's modifiedAt is offset BEFORE this. */
const ANCHOR_MS = new Date(2026, 4, 14, 10, 0, 0, 0).getTime();
const DAY_MS = 86_400_000;

function modifiedAt(daysAgo: number, hoursAgo = 0): number {
	return ANCHOR_MS - daysAgo * DAY_MS - hoursAgo * 3_600_000;
}

function bytesFor(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

const RELEASE_NOTES_MD = `# Brainstorm 0.20 — release notes

A short tour of what landed this iteration. The point of these notes is
to show the **markdown renderer** doing real work: paragraphs, *inline*
marks, fenced code, lists, and links.

## What shipped

- Preview app preview-drop — Image / Markdown / Text renderers wired
- Inspector pane with per-kind metadata
- Slideshow chrome: \`ArrowLeft\` / \`ArrowRight\` walk siblings

## Try it

\`\`\`ts
import { previewKindFor } from "@brainstorm-app/preview";
previewKindFor("text/markdown"); // → PreviewKind.Markdown
\`\`\`

See the full [implementation plan](https://example.invalid/plan) for
where this slots in.
`;

const README_MD = `# Preview

Quick-Look-style multi-format media previewer. **Strictly read-only** in
v1 — annotations land in dedicated editors.

## Why a thin shell?

Each renderer is its own engineering surface. The host owns chrome
(header, inspector, slideshow); each renderer owns its DOM subtree.

1. Mount the module
2. Show inspector metadata
3. Walk siblings via the keyboard

## Renderers in this drop

- Image — inline \`<img>\` with object-contain
- Markdown — safe subset, parsed to DOM nodes (no \`innerHTML\`)
- Text — \`<pre>\` with word-wrap
`;

const CHECKLIST_TXT = `Brainstorm — shipping checklist
================================

Before tagging v0.20:

  [ ] All Stage 9 OQs reviewed
  [ ] Coverage floor still green (>= 85% shell core)
  [ ] size-limit budgets unchanged
  [ ] Manifest validators pass for every first-party app
  [ ] No raw e.key outside shortcuts.ts files

After tagging:

  [ ] Push tag
  [ ] Draft release notes (use release-notes.md as a starting point)
  [ ] Mention in the implementation plan status snapshot
`;

const SERVER_LOG_TXT = `2026-05-14T10:00:01Z INFO  shell  vault opened (path=/Users/demo/.brainstorm/vault)
2026-05-14T10:00:01Z INFO  shell  workers spawned (storage, ydoc)
2026-05-14T10:00:01Z DEBUG broker registered service handlers
2026-05-14T10:00:02Z INFO  apps   io.brainstorm.preview launched
2026-05-14T10:00:02Z DEBUG preview registered renderers for image / markdown / text
2026-05-14T10:00:03Z INFO  apps   intent.dispatch open mime=text/markdown -> preview (secondary)
2026-05-14T10:00:03Z DEBUG preview mount id=demo-release-notes-md kind=markdown
2026-05-14T10:00:04Z DEBUG preview dispose previous renderer (id=demo-coastal-photo-jpg)
2026-05-14T10:00:05Z INFO  apps   intent.dispatch open mime=image/svg+xml -> preview (secondary)
`;

const COASTAL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1f3b6b"/>
      <stop offset="0.55" stop-color="#7aa1d9"/>
      <stop offset="1" stop-color="#f4d0a3"/>
    </linearGradient>
    <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3470a8"/>
      <stop offset="1" stop-color="#1a3852"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="540" fill="url(#sky)"/>
  <circle cx="900" cy="200" r="80" fill="#fff2c8" opacity="0.85"/>
  <rect y="540" width="1200" height="260" fill="url(#sea)"/>
  <path d="M0 540 Q 300 510 600 540 T 1200 540 V 800 H 0 Z" fill="#2c5a85" opacity="0.6"/>
  <path d="M0 600 Q 300 575 600 600 T 1200 600 V 800 H 0 Z" fill="#1f4a6f" opacity="0.55"/>
</svg>`;

const INTERFACE_MOCK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 640">
  <rect width="1024" height="640" fill="#1f2228"/>
  <rect x="32" y="32" width="240" height="576" rx="14" fill="#2b3038"/>
  <rect x="296" y="32" width="696" height="64" rx="14" fill="#2b3038"/>
  <rect x="296" y="112" width="696" height="496" rx="14" fill="#2b3038"/>
  <rect x="60" y="64" width="184" height="14" rx="3" fill="#4a5160"/>
  <rect x="60" y="92" width="120" height="10" rx="3" fill="#3a4050"/>
  <rect x="60" y="116" width="160" height="10" rx="3" fill="#3a4050"/>
  <rect x="60" y="140" width="140" height="10" rx="3" fill="#3a4050"/>
  <rect x="60" y="164" width="170" height="10" rx="3" fill="#3a4050"/>
  <rect x="328" y="56" width="320" height="16" rx="4" fill="#3a4050"/>
  <circle cx="960" cy="64" r="14" fill="#5b8def"/>
  <rect x="328" y="144" width="632" height="160" rx="10" fill="#363c46"/>
  <rect x="328" y="324" width="306" height="120" rx="10" fill="#363c46"/>
  <rect x="654" y="324" width="306" height="120" rx="10" fill="#363c46"/>
  <rect x="328" y="464" width="632" height="120" rx="10" fill="#363c46"/>
</svg>`;

function svgDataUrl(svg: string): string {
	// data: URL with a UTF-8 encoded SVG; CSP allows `img-src data:`. No
	// base64 — keeps the URL grep-able in devtools, smaller than base64.
	const encoded = encodeURIComponent(svg.replace(/\s+/g, " ").trim());
	return `data:image/svg+xml;charset=utf-8,${encoded}`;
}

/** Demo source-context bucket each ITEM belongs to. Drives
 *  `buildPreviewDemoContexts` so the standalone drop can show "From
 *  note: Coastal trip" with an image filmstrip + "From folder: Release
 *  docs" with the markdown / text set. */
type DemoBucket = "coastal-note" | "release-folder";

const ITEMS: ReadonlyArray<{
	id: string;
	name: string;
	mime: string;
	daysAgo: number;
	hoursAgo?: number;
	source: PreviewSource;
	bucket: DemoBucket;
}> = [
	{
		id: "demo-coastal-photo",
		name: "coastal-headland.svg",
		mime: "image/svg+xml",
		daysAgo: 0,
		hoursAgo: 2,
		bucket: "coastal-note",
		source: {
			kind: "url",
			url: svgDataUrl(COASTAL_SVG),
			mime: "image/svg+xml",
			sizeBytes: COASTAL_SVG.length,
		},
	},
	{
		id: "demo-interface-mockup",
		name: "interface-mockup.svg",
		mime: "image/svg+xml",
		daysAgo: 1,
		bucket: "coastal-note",
		source: {
			kind: "url",
			url: svgDataUrl(INTERFACE_MOCK_SVG),
			mime: "image/svg+xml",
			sizeBytes: INTERFACE_MOCK_SVG.length,
		},
	},
	{
		id: "demo-release-notes",
		name: "release-notes.md",
		mime: "text/markdown",
		daysAgo: 0,
		hoursAgo: 4,
		bucket: "release-folder",
		source: { kind: "bytes", bytes: bytesFor(RELEASE_NOTES_MD), mime: "text/markdown" },
	},
	{
		id: "demo-readme",
		name: "README.md",
		mime: "text/markdown",
		daysAgo: 2,
		bucket: "release-folder",
		source: { kind: "bytes", bytes: bytesFor(README_MD), mime: "text/markdown" },
	},
	{
		id: "demo-shipping-checklist",
		name: "shipping-checklist.txt",
		mime: "text/plain",
		daysAgo: 3,
		bucket: "release-folder",
		source: { kind: "bytes", bytes: bytesFor(CHECKLIST_TXT), mime: "text/plain" },
	},
	{
		id: "demo-server-log",
		name: "server.log",
		mime: "text/plain",
		daysAgo: 0,
		hoursAgo: 8,
		bucket: "release-folder",
		source: { kind: "bytes", bytes: bytesFor(SERVER_LOG_TXT), mime: "text/plain" },
	},
];

function buildItem(item: (typeof ITEMS)[number]): PreviewFile {
	const sizeBytes =
		item.source.kind === "bytes" ? item.source.bytes.byteLength : item.source.sizeBytes;
	const info: PreviewFileInfo = {
		name: item.name,
		mime: item.mime,
		sizeBytes,
		modifiedAt: modifiedAt(item.daysAgo, item.hoursAgo ?? 0),
	};
	return { id: item.id, info, source: item.source };
}

export function buildPreviewDemo(): ReadonlyArray<PreviewFile> {
	return ITEMS.map(buildItem);
}

export function buildPreviewDemoContexts(): ReadonlyArray<DemoContext> {
	const byBucket = new Map<DemoBucket, PreviewFile[]>();
	for (const item of ITEMS) {
		const list = byBucket.get(item.bucket) ?? [];
		list.push(buildItem(item));
		byBucket.set(item.bucket, list);
	}
	const coastal = byBucket.get("coastal-note") ?? [];
	const release = byBucket.get("release-folder") ?? [];
	return [
		{
			context: {
				kind: PreviewContextKind.Note,
				sourceId: "demo:coastal-trip",
				label: "Coastal trip notes",
			},
			siblings: coastal,
		},
		{
			context: {
				kind: PreviewContextKind.Folder,
				sourceId: "demo:release-folder",
				label: "Release docs",
			},
			siblings: release,
		},
	];
}

export function demoAnchorMs(): number {
	return ANCHOR_MS;
}
