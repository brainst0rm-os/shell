import { describe, expect, it } from "vitest";
import { PEER_COLORS, PEER_NAME_MAX_LEN, peerColor, sanitizePeerName } from "./peer-presence";

const ZWSP = String.fromCharCode(0x200b);
const RLO = String.fromCharCode(0x202e);
const NUL = String.fromCharCode(0x00);

describe("PEER_COLORS", () => {
	it("is non-empty and has no duplicates", () => {
		expect(PEER_COLORS.length).toBeGreaterThan(0);
		expect(new Set(PEER_COLORS).size).toBe(PEER_COLORS.length);
	});

	it("are all 6-digit hex strings", () => {
		for (const c of PEER_COLORS) expect(c).toMatch(/^#[0-9a-f]{6}$/);
	});
});

describe("peerColor", () => {
	it("is deterministic for a given seed", () => {
		expect(peerColor(42)).toBe(peerColor(42));
	});

	it("always returns a colour from the palette", () => {
		for (let seed = 0; seed < 50; seed++) {
			expect(PEER_COLORS).toContain(peerColor(seed));
		}
	});

	it("wraps modulo the palette length", () => {
		const n = PEER_COLORS.length;
		expect(peerColor(3)).toBe(peerColor(3 + n));
		expect(peerColor(3)).toBe(peerColor(3 + n * 7));
	});

	it("handles zero and is sign-safe for negatives", () => {
		expect(peerColor(0)).toBe(PEER_COLORS[0]);
		expect(PEER_COLORS).toContain(peerColor(-1));
		expect(PEER_COLORS).toContain(peerColor(-12345));
	});

	it("truncates a fractional seed before indexing", () => {
		expect(peerColor(2.9)).toBe(peerColor(2));
	});

	it("handles a large Yjs-style client id", () => {
		expect(PEER_COLORS).toContain(peerColor(4023456789));
	});
});

describe("sanitizePeerName", () => {
	it("trims surrounding whitespace", () => {
		expect(sanitizePeerName("  Ada  ", "x")).toBe("Ada");
	});

	it("collapses internal whitespace runs", () => {
		expect(sanitizePeerName("Ada   Lovelace", "x")).toBe("Ada Lovelace");
	});

	it("strips control, zero-width and bidi-override characters", () => {
		expect(sanitizePeerName(`A${NUL}${ZWSP}d${ZWSP}a${RLO}`, "x")).toBe("Ada");
	});

	it("falls back when the input is empty or whitespace-only", () => {
		expect(sanitizePeerName("", "Anon")).toBe("Anon");
		expect(sanitizePeerName("   ", "Anon")).toBe("Anon");
		expect(sanitizePeerName(`${ZWSP}${ZWSP}`, "Anon")).toBe("Anon");
	});

	it("falls back when the input is not a string", () => {
		expect(sanitizePeerName(null, "Anon")).toBe("Anon");
		expect(sanitizePeerName(undefined, "Anon")).toBe("Anon");
		expect(sanitizePeerName(42, "Anon")).toBe("Anon");
	});

	it("clamps to PEER_NAME_MAX_LEN", () => {
		const long = "x".repeat(PEER_NAME_MAX_LEN + 25);
		expect(sanitizePeerName(long, "Anon")).toHaveLength(PEER_NAME_MAX_LEN);
	});
});
