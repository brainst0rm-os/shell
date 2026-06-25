import { describe, expect, it } from "vitest";
import { FILE_TYPE, FOLDER_TYPE, ROOT_FOLDER_ID } from "../types/entity";
import { type VaultEntityInput, buildVaultFileTree } from "./vault-tree";

function folder(id: string, name: string, members: string[] = []): VaultEntityInput {
	return {
		id,
		type: FOLDER_TYPE,
		properties: { name, members },
		createdAt: 1,
		updatedAt: 2,
		deletedAt: null,
	};
}

function file(id: string, name: string): VaultEntityInput {
	return {
		id,
		type: FILE_TYPE,
		properties: { name, mime: "text/plain", size: 0 },
		createdAt: 1,
		updatedAt: 2,
		deletedAt: null,
	};
}

const NOW = 1_000;

describe("buildVaultFileTree", () => {
	it("synthesises an empty root for an empty vault (no demo bleed)", () => {
		const tree = buildVaultFileTree([], ROOT_FOLDER_ID, NOW);
		expect(tree).toHaveLength(1);
		const root = tree[0];
		expect(root?.id).toBe(ROOT_FOLDER_ID);
		expect(root?.type).toBe(FOLDER_TYPE);
		expect(root?.properties.members).toEqual([]);
		expect(root?.properties.name).toBe("Vault");
	});

	it("uses the real bootstrapped root Folder row when the snapshot carries it", () => {
		const entities: VaultEntityInput[] = [
			{
				id: ROOT_FOLDER_ID,
				type: FOLDER_TYPE,
				properties: { name: "My Vault", members: ["fld_a"], icon: { kind: "emoji", value: "📁" } },
				createdAt: 111,
				updatedAt: 222,
				deletedAt: null,
			},
			folder("fld_a", "Alpha"),
		];
		const tree = buildVaultFileTree(entities, ROOT_FOLDER_ID, NOW);
		const root = tree.find((e) => e.id === ROOT_FOLDER_ID);
		expect(root?.properties.name).toBe("My Vault");
		// Real row's own metadata (icon) + timestamps survive the projection.
		expect(root?.properties.icon).toEqual({ kind: "emoji", value: "📁" });
		expect(root?.createdAt).toBe(111);
		expect(root?.updatedAt).toBe(222);
		expect(root?.properties.members).toContain("fld_a");
	});

	it("respects nested folder membership and surfaces orphans at root", () => {
		const entities: VaultEntityInput[] = [
			folder(ROOT_FOLDER_ID, "Vault", ["fld_docs"]),
			folder("fld_docs", "Docs", ["fil_inner"]),
			file("fil_inner", "inner.txt"),
			file("fil_orphan", "orphan.txt"),
		];
		const tree = buildVaultFileTree(entities, ROOT_FOLDER_ID, NOW);
		const root = tree.find((e) => e.id === ROOT_FOLDER_ID);
		const docs = tree.find((e) => e.id === "fld_docs");
		expect(docs?.properties.members).toEqual(["fil_inner"]);
		const rootMembers = root?.properties.members as string[];
		// Declared first (fld_docs), then the orphan no folder contains.
		expect(rootMembers).toEqual(["fld_docs", "fil_orphan"]);
		expect(rootMembers).not.toContain("fil_inner");
	});

	it("drops soft-deleted rows and dangling member refs", () => {
		const entities: VaultEntityInput[] = [
			folder(ROOT_FOLDER_ID, "Vault", ["fld_gone", "fld_live"]),
			{ ...folder("fld_gone", "Gone"), deletedAt: 999 },
			folder("fld_live", "Live", ["missing-id"]),
		];
		const tree = buildVaultFileTree(entities, ROOT_FOLDER_ID, NOW);
		const root = tree.find((e) => e.id === ROOT_FOLDER_ID);
		const live = tree.find((e) => e.id === "fld_live");
		expect(tree.find((e) => e.id === "fld_gone")).toBeUndefined();
		expect((root?.properties.members as string[]).includes("fld_gone")).toBe(false);
		expect(live?.properties.members).toEqual([]);
	});

	it("never lets the root appear as another folder's member", () => {
		const entities: VaultEntityInput[] = [
			folder(ROOT_FOLDER_ID, "Vault", []),
			folder("fld_x", "X", [ROOT_FOLDER_ID, "fld_x"]),
		];
		const tree = buildVaultFileTree(entities, ROOT_FOLDER_ID, NOW);
		const x = tree.find((e) => e.id === "fld_x");
		expect(x?.properties.members).toEqual([]);
	});

	it("falls back to a synthetic root when the snapshot lacks the bootstrap row", () => {
		const entities: VaultEntityInput[] = [folder("fld_a", "Alpha"), file("fil_b", "b.txt")];
		const tree = buildVaultFileTree(entities, ROOT_FOLDER_ID, NOW);
		const root = tree.find((e) => e.id === ROOT_FOLDER_ID);
		expect(root?.createdAt).toBe(NOW);
		expect(root?.properties.members).toEqual(["fld_a", "fil_b"]);
	});

	it("shows only files and folders — notes/tasks/bookmarks/journal are excluded", () => {
		const foreign = (id: string, type: string): VaultEntityInput => ({
			id,
			type,
			properties: { title: id, name: id },
			createdAt: 1,
			updatedAt: 2,
			deletedAt: null,
		});
		const entities: VaultEntityInput[] = [
			folder(ROOT_FOLDER_ID, "Vault", ["fld_docs", "note_x"]),
			folder("fld_docs", "Docs", ["fil_inner", "task_y"]),
			file("fil_inner", "inner.txt"),
			file("fil_orphan", "orphan.txt"),
			foreign("note_x", "io.brainstorm.notes/Note/v1"),
			foreign("task_y", "brainstorm/Task/v1"),
			foreign("bm_z", "brainstorm/Bookmark/v1"),
			foreign("journal-2026-06-01", "io.brainstorm.journal/Entry/v1"),
		];
		const tree = buildVaultFileTree(entities, ROOT_FOLDER_ID, NOW);
		const ids = tree.map((e) => e.id);
		// Only the root + the two folders + the two files survive.
		expect(ids.sort()).toEqual([ROOT_FOLDER_ID, "fld_docs", "fil_inner", "fil_orphan"].sort());
		// Foreign-typed member refs are dropped from folder member lists.
		const root = tree.find((e) => e.id === ROOT_FOLDER_ID);
		const docs = tree.find((e) => e.id === "fld_docs");
		expect((root?.properties.members as string[]).includes("note_x")).toBe(false);
		expect((docs?.properties.members as string[]).includes("task_y")).toBe(false);
		expect(docs?.properties.members).toEqual(["fil_inner"]);
	});
});
