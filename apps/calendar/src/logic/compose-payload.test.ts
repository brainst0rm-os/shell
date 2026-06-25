import { describe, expect, it } from "vitest";
import { parseComposePayload } from "./compose-payload";

describe("parseComposePayload", () => {
	it("reads a numeric `start`", () => {
		expect(parseComposePayload({ start: 1_700_000_000_000 })).toEqual({
			start: 1_700_000_000_000,
		});
	});

	it("accepts `defaultStart` as an alias for `start`", () => {
		expect(parseComposePayload({ defaultStart: 1_700_000_000_000 })).toEqual({
			start: 1_700_000_000_000,
		});
		// `start` wins when both are present.
		expect(parseComposePayload({ start: 1, defaultStart: 2 })).toEqual({ start: 1 });
	});

	it("coerces a numeric string (intents cross a clone/JSON boundary)", () => {
		expect(parseComposePayload({ start: "1700000000000" })).toEqual({
			start: 1_700_000_000_000,
		});
	});

	it("returns null for missing / non-finite / non-positive start (→ caller fallback)", () => {
		expect(parseComposePayload({})).toBeNull();
		expect(parseComposePayload({ start: "soon" })).toBeNull();
		expect(parseComposePayload({ start: Number.NaN })).toBeNull();
		expect(parseComposePayload({ start: 0 })).toBeNull();
		expect(parseComposePayload({ start: -5 })).toBeNull();
		expect(parseComposePayload({ entityType: "brainstorm/Event/v1" })).toBeNull();
	});
});
