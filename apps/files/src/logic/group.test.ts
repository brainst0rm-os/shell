import { describe, expect, it } from "vitest";
import { type Entity, FILE_TYPE, FOLDER_TYPE } from "../types/entity";
import { GroupKey, groupEntities, isGroupKey } from "./group";

const LABELS = { folders: "Folders", noExtension: "No extension", otherLetter: "#" };

function entity(over: Partial<Entity> & { id: string }): Entity {
	return {
		type: FILE_TYPE,
		properties: { name: over.id },
		createdAt: 0,
		updatedAt: 0,
		deletedAt: null,
		...over,
	};
}

function named(id: string, name: string, over: Partial<Entity> = {}): Entity {
	return entity({ id, properties: { name }, ...over });
}

describe("groupEntities — Type", () => {
	it("buckets folders first, then file extensions A→Z, preserving inner order", () => {
		const rows = [
			named("b", "beta.png"),
			named("f", "Docs", { type: FOLDER_TYPE }),
			named("a", "alpha.pdf"),
			named("c", "gamma.PNG"),
			named("n", "readme"),
		];
		const groups = groupEntities(rows, GroupKey.Type, LABELS);
		expect(groups.map((g) => g.label)).toEqual(["Folders", "No extension", "PDF", "PNG"]);
		expect(groups[3]?.entities.map((e) => e.id)).toEqual(["b", "c"]);
	});

	it("buckets a non-file entity by its friendly type name", () => {
		const rows = [named("p", "Mira", { type: "brainstorm/Person/v1" })];
		expect(groupEntities(rows, GroupKey.Type, LABELS)[0]?.label).toBe("Person");
	});
});

describe("groupEntities — FirstLetter", () => {
	it("buckets by upper-cased first letter, non-letters last", () => {
		const rows = [named("n1", "zeta"), named("n2", "Alpha"), named("n3", "2026 plan")];
		const groups = groupEntities(rows, GroupKey.FirstLetter, LABELS);
		expect(groups.map((g) => g.label)).toEqual(["A", "Z", "#"]);
	});
});

describe("groupEntities — Month", () => {
	it("buckets by updatedAt month, newest first", () => {
		const june = new Date(2026, 5, 9).getTime();
		const april = new Date(2026, 3, 1).getTime();
		const rows = [
			named("old", "old", { updatedAt: april }),
			named("new", "new", { updatedAt: june }),
		];
		const groups = groupEntities(rows, GroupKey.Month, LABELS);
		expect(groups).toHaveLength(2);
		expect(groups[0]?.entities[0]?.id).toBe("new");
		expect(groups[0]?.label).toMatch(/2026/);
	});
});

describe("groupEntities — None + guard", () => {
	it("None returns one section with everything in order", () => {
		const rows = [named("a", "a"), named("b", "b")];
		const groups = groupEntities(rows, GroupKey.None, LABELS);
		expect(groups).toHaveLength(1);
		expect(groups[0]?.entities.map((e) => e.id)).toEqual(["a", "b"]);
	});

	it("isGroupKey accepts wire values and rejects junk", () => {
		expect(isGroupKey("type")).toBe(true);
		expect(isGroupKey("letter")).toBe(true);
		expect(isGroupKey("size")).toBe(false);
		expect(isGroupKey(42)).toBe(false);
	});
});
