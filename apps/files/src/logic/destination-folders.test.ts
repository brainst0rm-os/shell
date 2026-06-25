import { describe, expect, it } from "vitest";
import { type Entity, FILE_TYPE, FOLDER_TYPE, ROOT_FOLDER_ID } from "../types/entity";
import { type FolderTreeLike, destinationFolders } from "./destination-folders";

function folder(id: string, name: string): Entity {
	return {
		id,
		type: FOLDER_TYPE,
		properties: { name },
		createdAt: 0,
		updatedAt: 0,
		deletedAt: null,
	};
}

/** root → (a → (a1), b) plus a loose file that must never appear. */
function fakeTree(): FolderTreeLike {
	const folders = new Map<string, Entity>([
		[ROOT_FOLDER_ID, folder(ROOT_FOLDER_ID, "Vault")],
		["a", folder("a", "Alpha")],
		["a1", folder("a1", "Alpha child")],
		["b", folder("b", "Beta")],
	]);
	const children = new Map<string, string[]>([
		[ROOT_FOLDER_ID, ["a", "b"]],
		["a", ["a1"]],
	]);
	return {
		get: (id) =>
			id === "loose-file" ? { ...folder(id, "loose"), type: FILE_TYPE } : folders.get(id),
		listChildFolders: (id) =>
			(children.get(id) ?? [])
				.map((childId) => folders.get(childId))
				.filter((e): e is Entity => Boolean(e)),
	};
}

describe("destinationFolders (9.8.12)", () => {
	it("walks the full tree preorder with depth levels", () => {
		const out = destinationFolders(fakeTree(), new Set());
		expect(out.map((f) => `${f.level}:${f.name}`)).toEqual([
			"0:Vault",
			"1:Alpha",
			"2:Alpha child",
			"1:Beta",
		]);
	});

	it("excludes a moving folder AND its whole subtree", () => {
		const out = destinationFolders(fakeTree(), new Set(["a"]));
		expect(out.map((f) => f.name)).toEqual(["Vault", "Beta"]);
	});
});
