/**
 * Durable block-anchor core (B11.13) — fingerprinting, the store over a
 * plain Map (the same code path a Y.Map takes, structurally), and the
 * tiered re-resolution in `matchAnchorBlock`.
 */

import { describe, expect, it } from "vitest";
import {
	type BlockAnchorEntry,
	type BlockSnapshot,
	anchorEntriesEqual,
	coerceAnchorEntry,
	createMapBlockAnchorStore,
	fingerprintText,
	matchAnchorBlock,
} from "./block-anchors";

function entry(partial: Partial<BlockAnchorEntry> = {}): BlockAnchorEntry {
	return { type: "paragraph", text: "Hello durable anchors", index: 0, ...partial };
}

function block(key: string, partial: Partial<BlockAnchorEntry> = {}): BlockSnapshot {
	return { key, ...entry(partial) };
}

describe("fingerprintText", () => {
	it("collapses whitespace runs and trims", () => {
		expect(fingerprintText("  a\n\tb   c  ")).toBe("a b c");
	});

	it("caps at 240 chars", () => {
		expect(fingerprintText("x".repeat(500))).toHaveLength(240);
	});
});

describe("coerceAnchorEntry", () => {
	it("round-trips a valid entry", () => {
		expect(coerceAnchorEntry({ type: "paragraph", text: "t", index: 2 })).toEqual({
			type: "paragraph",
			text: "t",
			index: 2,
		});
	});

	it.each([
		[null],
		["string"],
		[{ type: "p", text: "t" }],
		[{ type: "p", index: 1 }],
		[{ text: "t", index: 1 }],
		[{ type: "p", text: "t", index: Number.NaN }],
		[{ type: 1, text: "t", index: 0 }],
	])("rejects malformed shape %#", (raw) => {
		expect(coerceAnchorEntry(raw)).toBeNull();
	});
});

describe("createMapBlockAnchorStore", () => {
	it("set/get round-trips through a plain Map", () => {
		const store = createMapBlockAnchorStore(new Map<string, unknown>());
		store.set("a1", entry());
		expect(store.get("a1")).toEqual(entry());
	});

	it("get returns null for an absent or malformed value", () => {
		const map = new Map<string, unknown>([["bad", { nope: true }]]);
		const store = createMapBlockAnchorStore(map);
		expect(store.get("missing")).toBeNull();
		expect(store.get("bad")).toBeNull();
	});

	it("findByEntry reuses an identical persisted entry and ignores near-misses", () => {
		const store = createMapBlockAnchorStore(new Map<string, unknown>());
		store.set("a1", entry());
		expect(store.findByEntry(entry())).toBe("a1");
		expect(store.findByEntry(entry({ text: "different" }))).toBeNull();
		expect(store.findByEntry(entry({ index: 9 }))).toBeNull();
	});
});

describe("anchorEntriesEqual", () => {
	it("compares all three fields", () => {
		expect(anchorEntriesEqual(entry(), entry())).toBe(true);
		expect(anchorEntriesEqual(entry(), entry({ type: "heading" }))).toBe(false);
		expect(anchorEntriesEqual(entry(), entry({ text: "x" }))).toBe(false);
		expect(anchorEntriesEqual(entry(), entry({ index: 1 }))).toBe(false);
	});
});

describe("matchAnchorBlock", () => {
	it("tier 1 — exact text match wins regardless of type (turn-into survives)", () => {
		const blocks = [
			block("k1", { text: "other text entirely" }),
			block("k2", { type: "heading", text: "Hello durable anchors", index: 3 }),
		];
		expect(matchAnchorBlock(entry(), blocks)).toBe("k2");
	});

	it("tier 1 — duplicate exact texts tie-break on index distance", () => {
		const blocks = [
			block("far", { text: "dup", index: 9 }),
			block("near", { text: "dup", index: 3 }),
		];
		expect(matchAnchorBlock(entry({ text: "dup", index: 2 }), blocks)).toBe("near");
	});

	it("tier 2 — an extended block (anchor text is its prefix) still matches", () => {
		const blocks = [
			block("k1", { text: "Hello durable anchors and some appended words" }),
			block("k2", { text: "unrelated content here" }),
		];
		expect(matchAnchorBlock(entry(), blocks)).toBe("k1");
	});

	it("tier 2 — a truncated/split block (its text is the anchor's prefix) still matches", () => {
		const blocks = [block("k1", { text: "Hello durable" })];
		expect(matchAnchorBlock(entry(), blocks)).toBe("k1");
	});

	it("tier 2 — a short common sentence opener does not bind the wrong block", () => {
		const blocks = [block("k1", { text: "The dog barked at midnight" })];
		expect(matchAnchorBlock(entry({ text: "The cat sat on the mat quietly" }), blocks)).toBeNull();
	});

	it("tier 2 — overlap below half the shorter text is rejected", () => {
		// 12 shared chars, but the shorter text is 40 chars → 12*2 < 40.
		const shared = "Shared start";
		const blocks = [block("k1", { text: `${shared} then this block goes elsewhere` })];
		expect(
			matchAnchorBlock(entry({ text: `${shared} but the anchor text diverges here` }), blocks),
		).toBeNull();
	});

	it("tier 2 — best overlap wins over a shorter qualifying overlap", () => {
		const blocks = [
			block("short", { text: "Hello durable things happened" }),
			block("long", { text: "Hello durable anchors forever" }),
		];
		expect(matchAnchorBlock(entry(), blocks)).toBe("long");
	});

	it("tier 3 — a text-less anchor matches same-type closest-index", () => {
		const blocks = [
			block("img-far", { type: "image", text: "", index: 8 }),
			block("img-near", { type: "image", text: "", index: 2 }),
			block("p", { type: "paragraph", text: "", index: 1 }),
		];
		expect(matchAnchorBlock(entry({ type: "image", text: "", index: 1 }), blocks)).toBe("img-near");
	});

	it("tier 3 — no same-type text-less block degrades to null", () => {
		const blocks = [block("p", { type: "paragraph", text: "has text", index: 0 })];
		expect(matchAnchorBlock(entry({ type: "image", text: "", index: 0 }), blocks)).toBeNull();
	});

	it("empty document degrades to null", () => {
		expect(matchAnchorBlock(entry(), [])).toBeNull();
	});
});
