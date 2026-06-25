import { describe, expect, it } from "vitest";
import { type VaultEntityInput, buildVaultFileTree } from "../src/logic/vault-tree";
import { FILE_TYPE, FOLDER_TYPE } from "../src/types/entity";

const ROOT = "vault-root";
const NOW = 1_000;

// Non-folder rows default to File/v1 — Files scopes its tree to File/Folder
// entities, so a generic vault object (note/task/…) would be excluded.
function ent(over: Partial<VaultEntityInput> & { id: string }): VaultEntityInput {
	return {
		type: FILE_TYPE,
		properties: {},
		createdAt: 1,
		updatedAt: 2,
		deletedAt: null,
		...over,
	};
}

function tree(entities: VaultEntityInput[]) {
	const out = buildVaultFileTree(entities, ROOT, NOW);
	const root = out[0];
	if (!root || root.id !== ROOT) throw new Error("root must be first");
	return { root, all: out, members: root.properties.members as string[] };
}

describe("buildVaultFileTree", () => {
	it("prepends a synthetic root; an empty vault yields a childless root (honest empty state)", () => {
		const { root, all, members } = tree([]);
		expect(all).toHaveLength(1);
		expect(root.type).toBe(FOLDER_TYPE);
		expect(members).toEqual([]);
	});

	it("surfaces uncontained entities at the root, folders before others, snapshot order kept", () => {
		const { members } = tree([
			ent({ id: "note-a", properties: { title: "A" } }),
			ent({ id: "f1", type: FOLDER_TYPE, properties: { name: "Folder" } }),
			ent({ id: "note-b", properties: { title: "B" } }),
		]);
		expect(members).toEqual(["f1", "note-a", "note-b"]);
	});

	it("respects real Folder/v1 membership and nests folders", () => {
		const { all, members } = tree([
			ent({ id: "f1", type: FOLDER_TYPE, properties: { name: "Top", members: ["f2", "n1"] } }),
			ent({ id: "f2", type: FOLDER_TYPE, properties: { name: "Sub", members: ["n2"] } }),
			ent({ id: "n1", properties: { title: "in top" } }),
			ent({ id: "n2", properties: { title: "in sub" } }),
		]);
		// Only f1 is uncontained — f2/n1/n2 are inside folders.
		expect(members).toEqual(["f1"]);
		expect(all.find((e) => e.id === "f1")?.properties.members).toEqual(["f2", "n1"]);
		expect(all.find((e) => e.id === "f2")?.properties.members).toEqual(["n2"]);
	});

	it("drops soft-deleted entities and prunes dangling / self member refs", () => {
		const { all, members } = tree([
			ent({
				id: "f1",
				type: FOLDER_TYPE,
				properties: { name: "F", members: ["gone", "f1", "n1", "n1"] },
			}),
			ent({ id: "n1", properties: { title: "live" } }),
			ent({ id: "gone", deletedAt: 5, properties: { title: "deleted" } }),
		]);
		expect(all.map((e) => e.id).sort()).toEqual(["f1", "n1", ROOT].sort());
		const f1 = all.find((e) => e.id === "f1");
		// "gone" (deleted), "f1" (self), duplicate "n1" all pruned.
		expect(f1?.properties.members).toEqual(["n1"]);
		// n1 is contained by f1, so it is NOT also at the root.
		expect(members).toEqual(["f1"]);
	});

	it("falls back to `(untitled)` and maps name from title or name", () => {
		const all = buildVaultFileTree(
			[ent({ id: "n1", properties: { title: "Has Title" } }), ent({ id: "n2", properties: {} })],
			ROOT,
			NOW,
		);
		expect(all.find((e) => e.id === "n1")?.properties.name).toBe("Has Title");
		expect(all.find((e) => e.id === "n2")?.properties.name).toBe("(untitled)");
	});
});
