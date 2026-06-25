import { describe, expect, it } from "vitest";
import { applyFieldMap, readPath } from "./field-map";

describe("field-map", () => {
	it("reads dotted paths and returns undefined for missing segments", () => {
		const resource = { title: "Bug", user: { login: "octocat" }, n: 3 };
		expect(readPath(resource, "title")).toBe("Bug");
		expect(readPath(resource, "user.login")).toBe("octocat");
		expect(readPath(resource, "user.missing")).toBeUndefined();
		expect(readPath(resource, "n.deep")).toBeUndefined();
	});

	it("projects mapped fields and skips undefined sources", () => {
		const resource = { title: "Bug", state: "open", user: { login: "octocat" } };
		expect(
			applyFieldMap(
				{ title: "title", status: "state", assignee: "user.login", missing: "nope" },
				resource,
			),
		).toEqual({ title: "Bug", status: "open", assignee: "octocat" });
	});

	it("translates an external value through a value map", () => {
		const map = { from: "state", map: { open: "todo", closed: "done" }, default: "todo" };
		expect(applyFieldMap({ status: map }, { state: "closed" })).toEqual({ status: "done" });
		expect(applyFieldMap({ status: map }, { state: "open" })).toEqual({ status: "todo" });
	});

	it("falls back to default for an unmapped value and skips a missing source", () => {
		const map = { from: "state", map: { open: "todo" }, default: "todo" };
		// Unmapped external value → default, never the raw provider value.
		expect(applyFieldMap({ status: map }, { state: "weird" })).toEqual({ status: "todo" });
		// Missing source field → property left unset (no default written).
		const noDefault = { from: "state", map: { open: "todo" } };
		expect(applyFieldMap({ status: noDefault }, { other: 1 })).toEqual({});
		expect(applyFieldMap({ status: noDefault }, { state: "weird" })).toEqual({});
	});
});
