import { describe, expect, it } from "vitest";
import {
	PROTOCOL_VERSION,
	type RoutingHeader,
	WireKind,
	canonicalizeRoutingHeader,
	parseRoutingHeaderJson,
} from "./routing-header";

const baseHeader = (): RoutingHeader => ({
	v: PROTOCOL_VERSION,
	kind: WireKind.Update,
	entityId: "ent_abc",
	sender: "DEV-pubkey-b64url",
	seq: 1,
	nonce: "nonce-b64",
	ts: 1779000000000,
});

describe("canonicalizeRoutingHeader", () => {
	it("emits pinned key order regardless of input insertion order", () => {
		const expected = canonicalizeRoutingHeader(baseHeader());
		// 64-pass property: random key permutations of a constructed header
		// must canonicalise to identical bytes.
		const keys: (keyof RoutingHeader)[] = ["ts", "nonce", "seq", "sender", "entityId", "kind", "v"];
		for (let run = 0; run < 64; run++) {
			const shuffled = [...keys].sort(() => Math.random() - 0.5);
			const acc: Record<string, unknown> = {};
			const src = baseHeader();
			for (const k of shuffled) acc[k] = src[k];
			const bytes = canonicalizeRoutingHeader(acc as RoutingHeader);
			expect(bytes).toEqual(expected);
		}
	});

	it('output starts with `{"v":1,"kind":` — pinned-prefix invariance', () => {
		const bytes = canonicalizeRoutingHeader(baseHeader());
		const text = new TextDecoder().decode(bytes);
		expect(text.startsWith('{"v":1,"kind":')).toBe(true);
	});

	it("Collab-C5 — omits `route` when absent (byte-identical to the pre-C5 format)", () => {
		const bytes = canonicalizeRoutingHeader(baseHeader());
		// No `route` field ⇒ the canonical bytes never mention it (a pre-C5 frame
		// signs + canonicalises exactly as before).
		expect(new TextDecoder().decode(bytes).includes("route")).toBe(false);
		// And it round-trips back to a header with no `route`.
		expect(parseRoutingHeaderJson(bytes).route).toBeUndefined();
	});

	it("Collab-C5 — appends `route` LAST when present, and it round-trips", () => {
		const bytes = canonicalizeRoutingHeader({ ...baseHeader(), route: "inbox:bob" });
		const json = new TextDecoder().decode(bytes);
		expect(json.endsWith('"route":"inbox:bob"}')).toBe(true);
		expect(parseRoutingHeaderJson(bytes).route).toBe("inbox:bob");
	});

	it("differs by even one byte when any field changes", () => {
		const a = canonicalizeRoutingHeader(baseHeader());
		const b = canonicalizeRoutingHeader({ ...baseHeader(), seq: 2 });
		expect(a).not.toEqual(b);
	});
});

describe("parseRoutingHeaderJson", () => {
	const enc = new TextEncoder();

	it("round-trips a well-formed header", () => {
		const bytes = canonicalizeRoutingHeader(baseHeader());
		expect(parseRoutingHeaderJson(bytes)).toEqual(baseHeader());
	});

	it("rejects v != PROTOCOL_VERSION as Invalid", () => {
		const bytes = enc.encode(JSON.stringify({ ...baseHeader(), v: 2 }));
		expect(() => parseRoutingHeaderJson(bytes)).toThrow(/unsupported v=2/);
	});

	it("rejects unknown enum value with Invalid", () => {
		const bytes = enc.encode(JSON.stringify({ ...baseHeader(), kind: "rotation" }));
		expect(() => parseRoutingHeaderJson(bytes)).toThrow(/unknown kind=rotation/);
	});

	it("rejects missing field (no entityId)", () => {
		const { entityId: _drop, ...rest } = baseHeader();
		const bytes = enc.encode(JSON.stringify(rest));
		expect(() => parseRoutingHeaderJson(bytes)).toThrow(/entityId/);
	});

	it("rejects wrong-typed field (seq as string)", () => {
		const bytes = enc.encode(JSON.stringify({ ...baseHeader(), seq: "1" }));
		expect(() => parseRoutingHeaderJson(bytes)).toThrow(/seq/);
	});

	it("rejects malformed JSON", () => {
		expect(() => parseRoutingHeaderJson(enc.encode("{nope"))).toThrow(/malformed JSON/);
	});

	it("accepts long entityIds (stress)", () => {
		const longId = `ent_${"x".repeat(1024)}`;
		const h = { ...baseHeader(), entityId: longId };
		const bytes = canonicalizeRoutingHeader(h);
		expect(parseRoutingHeaderJson(bytes).entityId).toBe(longId);
	});
});
