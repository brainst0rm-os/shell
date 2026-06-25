import { describe, expect, it } from "vitest";
import { type Entity, FILE_TYPE, FOLDER_TYPE, ROOT_FOLDER_ID } from "../types/entity";
import { FolderTree } from "./folder-tree";
import { flattenVisibleTree } from "./tree-flatten";

function fld(id: string, members: string[] = []): Entity {
	return {
		id,
		type: FOLDER_TYPE,
		properties: { name: id, members },
		createdAt: 0,
		updatedAt: 0,
		deletedAt: null,
	};
}

function fil(id: string): Entity {
	return {
		id,
		type: FILE_TYPE,
		properties: { name: id, mime: "text/plain", size: 0 },
		createdAt: 0,
		updatedAt: 0,
		deletedAt: null,
	};
}

function makeTree(): FolderTree {
	const tree = new FolderTree();
	tree.applySnapshot([
		fld(ROOT_FOLDER_ID, ["a", "b", "f1"]),
		fld("a", ["aa"]),
		fld("aa", []),
		fld("b", ["bb"]),
		fld("bb", []),
		fil("f1"),
	]);
	return tree;
}

describe("flattenVisibleTree", () => {
	it("yields only the root when nothing is expanded", () => {
		const flat = flattenVisibleTree(makeTree(), new Set());
		expect(flat.map((n) => n.id)).toEqual([ROOT_FOLDER_ID]);
		expect(flat[0]).toMatchObject({ level: 0, parentId: null, hasChildren: true, expanded: false });
	});

	it("includes child folders of expanded parents in preorder, files excluded", () => {
		const flat = flattenVisibleTree(makeTree(), new Set([ROOT_FOLDER_ID, "a"]));
		// f1 is a file, never a tree node; aa appears because a is expanded.
		expect(flat.map((n) => n.id)).toEqual([ROOT_FOLDER_ID, "a", "aa", "b"]);
	});

	it("stamps level, parentId, and hasChildren per node", () => {
		const flat = flattenVisibleTree(makeTree(), new Set([ROOT_FOLDER_ID]));
		const byId = new Map(flat.map((n) => [n.id, n]));
		expect(byId.get("a")).toMatchObject({ level: 1, parentId: ROOT_FOLDER_ID, hasChildren: true });
		expect(byId.get("b")).toMatchObject({ level: 1, parentId: ROOT_FOLDER_ID, hasChildren: true });
		// A collapsed parent reports hasChildren but contributes no descendants.
		expect(byId.has("aa")).toBe(false);
	});
});
