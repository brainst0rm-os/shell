import type { LexicalNode } from "lexical";
import { describe, expect, it } from "vitest";
import { BLOCK_ID_ATTR, mintBlockId, stableBlockId } from "./block-id";

/** Minimal stand-in for a Lexical node — `stableBlockId` only reads `.getKey()`. */
function fakeNode(key: string): LexicalNode {
	return { getKey: () => key } as unknown as LexicalNode;
}

describe("BLOCK_ID_ATTR", () => {
	it("is the contract-fixed `data-bs-block` attribute (shared with OQ-183 StylePack hooks)", () => {
		expect(BLOCK_ID_ATTR).toBe("data-bs-block");
	});
});

describe("stableBlockId", () => {
	it("returns the LexicalNode's `.getKey()` value", () => {
		expect(stableBlockId(fakeNode("abc"))).toBe("abc");
	});

	it("returns different ids for two distinct keys", () => {
		expect(stableBlockId(fakeNode("k1"))).not.toBe(stableBlockId(fakeNode("k2")));
	});

	it("is deterministic — same node twice yields the same id", () => {
		const node = fakeNode("stable-7");
		expect(stableBlockId(node)).toBe(stableBlockId(node));
	});

	it("is purely a delegation to `.getKey()` (no extra prefix / hashing / suffix)", () => {
		expect(stableBlockId(fakeNode(""))).toBe("");
		expect(stableBlockId(fakeNode("0"))).toBe("0");
		expect(stableBlockId(fakeNode("with-dashes-42"))).toBe("with-dashes-42");
	});

	it("reads `.getKey()` on every call (delegates, doesn't cache)", () => {
		let calls = 0;
		const node = { getKey: () => `k${++calls}` } as unknown as LexicalNode;
		expect(stableBlockId(node)).toBe("k1");
		expect(stableBlockId(node)).toBe("k2");
		expect(calls).toBe(2);
	});
});

describe("mintBlockId", () => {
	it("returns a non-empty string", () => {
		expect(mintBlockId().length).toBeGreaterThan(0);
	});

	it("mints a fresh id on every call (no collisions across many mints)", () => {
		const ids = new Set(Array.from({ length: 1000 }, () => mintBlockId()));
		expect(ids.size).toBe(1000);
	});
});
