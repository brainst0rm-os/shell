import { describe, expect, it } from "vitest";
import { readDottedPath } from "./entity-fallback";

describe("readDottedPath", () => {
	it("reads top-level fields", () => {
		expect(readDottedPath({ title: "Hello" }, "title")).toBe("Hello");
	});

	it("reads nested fields", () => {
		expect(readDottedPath({ meta: { author: "alice" } }, "meta.author")).toBe("alice");
	});

	it("supports a leading $.", () => {
		expect(readDottedPath({ title: "Hi" }, "$.title")).toBe("Hi");
		expect(readDottedPath({ a: { b: 1 } }, "$.a.b")).toBe(1);
	});

	it("returns undefined for missing fields", () => {
		expect(readDottedPath({}, "title")).toBeUndefined();
		expect(readDottedPath({ a: 1 }, "a.b")).toBeUndefined();
		expect(readDottedPath({ a: null }, "a.b")).toBeUndefined();
	});

	it("returns undefined when traversing through a non-object", () => {
		expect(readDottedPath({ a: 1 }, "a.b.c")).toBeUndefined();
	});

	it("preserves zero / false / empty-string values", () => {
		expect(readDottedPath({ count: 0 }, "count")).toBe(0);
		expect(readDottedPath({ on: false }, "on")).toBe(false);
		expect(readDottedPath({ name: "" }, "name")).toBe("");
	});
});
