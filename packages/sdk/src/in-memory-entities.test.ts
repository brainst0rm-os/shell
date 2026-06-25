import { describe, expect, it } from "vitest";
import { type EntityRow, emptyVault, readPropertyPath } from "./in-memory-entities";

function entity(properties: Record<string, unknown>): EntityRow {
	return { id: "e1", type: "t", properties, createdAt: 0, updatedAt: 0, deletedAt: null };
}

describe("emptyVault", () => {
	it("returns empty entity + link arrays", () => {
		expect(emptyVault()).toEqual({ entities: [], links: [] });
	});
});

describe("readPropertyPath", () => {
	it("reads a single-segment property directly", () => {
		expect(readPropertyPath(entity({ title: "Hi", tags: ["a", "b"] }), "title")).toBe("Hi");
		expect(readPropertyPath(entity({ tags: ["a", "b"] }), "tags")).toEqual(["a", "b"]);
	});

	it("returns undefined for a missing single-segment property", () => {
		expect(readPropertyPath(entity({}), "nope")).toBeUndefined();
	});

	it("maps a dotted path across an array of envelopes", () => {
		const e = entity({ phones: [{ value: "+1", label: "home" }, { value: "+2" }] });
		expect(readPropertyPath(e, "phones.value")).toEqual(["+1", "+2"]);
	});

	it("reads a dotted path on a single object envelope", () => {
		expect(readPropertyPath(entity({ author: { value: "Ann" } }), "author.value")).toBe("Ann");
	});

	it("returns an empty array when no array entry has the tail field", () => {
		expect(readPropertyPath(entity({ phones: [{ label: "x" }] }), "phones.value")).toEqual([]);
	});

	it("returns undefined when the head is a scalar (not object/array)", () => {
		expect(readPropertyPath(entity({ title: "scalar" }), "title.value")).toBeUndefined();
	});
});
