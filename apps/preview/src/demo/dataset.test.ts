/**
 * Demo dataset assertions — the in-memory file set the 9.20.1.5 preview
 * drop walks. Deliberately permissive on per-row content (this is a
 * demo, not contract data) but strict on shape so the renderers can
 * trust the input.
 */

import { describe, expect, it } from "vitest";
import { previewKindFor } from "../logic/preview-kind-for";
import { PreviewContextKind } from "../types/preview-context";
import { buildPreviewDemo, buildPreviewDemoContexts, demoAnchorMs } from "./dataset";

describe("buildPreviewDemo", () => {
	it("returns at least two files in each of: image / markdown / text — enough to drive the slideshow nav", () => {
		const files = buildPreviewDemo();
		const groups = new Map<string, number>();
		for (const f of files) {
			const kind = previewKindFor(f.info.mime);
			if (!kind) throw new Error(`demo file ${f.id} has unresolvable mime ${f.info.mime}`);
			groups.set(kind, (groups.get(kind) ?? 0) + 1);
		}
		expect(groups.get("image") ?? 0).toBeGreaterThanOrEqual(2);
		expect(groups.get("markdown") ?? 0).toBeGreaterThanOrEqual(2);
		expect(groups.get("text") ?? 0).toBeGreaterThanOrEqual(2);
	});

	it("every entry has a positive sizeBytes and a modifiedAt at or before the anchor", () => {
		const files = buildPreviewDemo();
		const anchor = demoAnchorMs();
		for (const f of files) {
			expect(f.info.sizeBytes, f.id).not.toBeNull();
			expect(f.info.sizeBytes ?? 0).toBeGreaterThan(0);
			expect(f.info.modifiedAt, f.id).not.toBeNull();
			expect(f.info.modifiedAt ?? 0).toBeLessThanOrEqual(anchor);
		}
	});

	it("ids are unique — the host keys siblings by id", () => {
		const ids = buildPreviewDemo().map((f) => f.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("url sources are data: / blob: / brainstorm: only — the app CSP forbids https loads", () => {
		const files = buildPreviewDemo();
		const urlSources = files.filter((f) => f.source.kind === "url");
		for (const f of urlSources) {
			if (f.source.kind !== "url") continue;
			const ok =
				f.source.url.startsWith("data:") ||
				f.source.url.startsWith("blob:") ||
				f.source.url.startsWith("brainstorm:");
			expect(ok, `${f.id}: ${f.source.url.slice(0, 40)}`).toBe(true);
		}
	});

	it("bytes sources carry actual data (non-zero length) and a non-empty mime", () => {
		const files = buildPreviewDemo();
		const byteSources = files.filter((f) => f.source.kind === "bytes");
		for (const f of byteSources) {
			if (f.source.kind !== "bytes") continue;
			expect(f.source.bytes.byteLength, f.id).toBeGreaterThan(0);
			expect(f.source.mime.length, f.id).toBeGreaterThan(0);
		}
	});

	it("anchor falls on 2026-05-14 — keeps snapshots deterministic across time", () => {
		const d = new Date(demoAnchorMs());
		expect(d.getFullYear()).toBe(2026);
		expect(d.getMonth()).toBe(4); // May (0-indexed)
		expect(d.getDate()).toBe(14);
	});
});

describe("buildPreviewDemoContexts", () => {
	it("returns at least one note-kind + one folder-kind context — drives the chip + gallery demo", () => {
		const ctxs = buildPreviewDemoContexts();
		const kinds = new Set(ctxs.map((c) => c.context.kind));
		expect(kinds.has(PreviewContextKind.Note)).toBe(true);
		expect(kinds.has(PreviewContextKind.Folder)).toBe(true);
	});

	it("every context has a human-readable label + a non-empty siblings list", () => {
		for (const c of buildPreviewDemoContexts()) {
			expect(c.context.label, c.context.sourceId ?? "").toBeTruthy();
			expect(c.siblings.length, c.context.label ?? "").toBeGreaterThan(0);
		}
	});

	it("note context contains only image kinds — that's the gallery use-case from the spec", () => {
		const note = buildPreviewDemoContexts().find((c) => c.context.kind === PreviewContextKind.Note);
		expect(note, "demo must include a note context").toBeDefined();
		if (!note) return;
		for (const sib of note.siblings) {
			expect(previewKindFor(sib.info.mime), sib.id).toBe("image");
		}
	});

	it("union of every context covers the full demo (no orphan items)", () => {
		const all = new Set(buildPreviewDemo().map((f) => f.id));
		const grouped = new Set<string>();
		for (const c of buildPreviewDemoContexts()) {
			for (const s of c.siblings) grouped.add(s.id);
		}
		expect(grouped).toEqual(all);
	});
});
