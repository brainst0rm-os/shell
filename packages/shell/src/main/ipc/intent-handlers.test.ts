import { describe, expect, it } from "vitest";
import { validateIntentEnvelope } from "./intent-handlers";

describe("validateIntentEnvelope", () => {
	it("accepts a minimal { verb, payload } envelope", () => {
		expect(validateIntentEnvelope({ verb: "open", payload: { entityId: "x" } })).toEqual({
			verb: "open",
			payload: { entityId: "x" },
		});
	});

	it("normalises missing payload to {}", () => {
		expect(validateIntentEnvelope({ verb: "compose" })).toEqual({
			verb: "compose",
			payload: {},
		});
	});

	it("normalises null payload to {}", () => {
		expect(validateIntentEnvelope({ verb: "compose", payload: null })).toEqual({
			verb: "compose",
			payload: {},
		});
	});

	it("rejects empty verb", () => {
		expect(validateIntentEnvelope({ verb: "", payload: {} })).toBeNull();
	});

	it("rejects non-string verb", () => {
		expect(validateIntentEnvelope({ verb: 1, payload: {} })).toBeNull();
	});

	it("rejects array payload", () => {
		expect(validateIntentEnvelope({ verb: "open", payload: ["entityId"] })).toBeNull();
	});

	it("rejects primitive payload", () => {
		expect(validateIntentEnvelope({ verb: "open", payload: "x" })).toBeNull();
		expect(validateIntentEnvelope({ verb: "open", payload: 5 })).toBeNull();
	});

	it("rejects null / primitive input", () => {
		expect(validateIntentEnvelope(null)).toBeNull();
		expect(validateIntentEnvelope(undefined)).toBeNull();
		expect(validateIntentEnvelope("open")).toBeNull();
	});

	it("rejects arrays at the envelope level", () => {
		expect(validateIntentEnvelope([{ verb: "open" }])).toBeNull();
	});
});
