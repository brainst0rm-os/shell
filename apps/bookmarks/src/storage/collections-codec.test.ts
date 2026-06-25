import { describe, expect, it } from "vitest";
import { CollectionKind } from "../logic/collections";
import { BookmarkSurface } from "../types/surface";
import { parseCollection, parseCollections } from "./collections-codec";

const SMART = {
	id: "c1",
	name: "Design reads",
	kind: "smart",
	filter: { surface: "read", tags: ["Design", "design"], query: "systems" },
	createdAt: 1,
	updatedAt: 2,
};

describe("parseCollection", () => {
	it("round-trips a smart collection and normalizes its filter tags", () => {
		const c = parseCollection(SMART);
		expect(c?.kind).toBe(CollectionKind.Smart);
		expect(c?.filter?.surface).toBe(BookmarkSurface.Read);
		// "Design" + "design" normalize + dedup to one.
		expect(c?.filter?.tags).toEqual(["design"]);
		expect(c?.filter?.query).toBe("systems");
	});

	it("round-trips a manual collection's member ids, dropping non-strings", () => {
		const c = parseCollection({
			id: "m1",
			name: "Picks",
			kind: "manual",
			memberIds: ["a", "", 5, "b"],
			createdAt: 1,
			updatedAt: 1,
		});
		expect(c?.kind).toBe(CollectionKind.Manual);
		expect(c?.memberIds).toEqual(["a", "b"]);
	});

	it("rejects rows missing id / name / kind / timestamps", () => {
		expect(parseCollection(null)).toBeNull();
		expect(parseCollection({ ...SMART, id: "" })).toBeNull();
		expect(parseCollection({ ...SMART, name: "  " })).toBeNull();
		expect(parseCollection({ ...SMART, kind: "weird" })).toBeNull();
		expect(parseCollection({ ...SMART, createdAt: "nope" })).toBeNull();
	});

	it("drops an unknown surface but keeps the rest of the filter", () => {
		const c = parseCollection({ ...SMART, filter: { surface: "moon", tags: ["x"] } });
		expect(c?.filter?.surface).toBeUndefined();
		expect(c?.filter?.tags).toEqual(["x"]);
	});
});

describe("parseCollections", () => {
	it("filters out malformed entries", () => {
		const list = parseCollections([SMART, null, { id: "bad" }, { ...SMART, id: "c2" }]);
		expect(list.map((c) => c.id)).toEqual(["c1", "c2"]);
	});

	it("returns an empty list for a non-array", () => {
		expect(parseCollections(undefined)).toEqual([]);
		expect(parseCollections("nope")).toEqual([]);
	});
});
