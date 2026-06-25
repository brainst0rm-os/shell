// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { SearchScope } from "./search";
import {
	MAX_SMART_FOLDERS,
	type SmartFolder,
	deleteSmartFolder,
	normalizeSmartFolderName,
	readSmartFolders,
	renameSmartFolder,
	saveSmartFolder,
} from "./smart-folders";

afterEach(() => localStorage.clear());

function save(
	existing: readonly SmartFolder[],
	over: Partial<Parameters<typeof saveSmartFolder>[1]> = {},
) {
	return saveSmartFolder(existing, {
		name: "Designs",
		query: "design",
		scope: SearchScope.Vault,
		folderId: "root",
		now: 1000,
		id: "sf_1",
		...over,
	});
}

describe("smart folders (9.8.9)", () => {
	it("starts empty", () => {
		expect(readSmartFolders()).toEqual([]);
	});

	it("saves and reads back a search", () => {
		const after = save([]);
		expect(after).toHaveLength(1);
		expect(after[0]).toMatchObject({
			id: "sf_1",
			name: "Designs",
			query: "design",
			scope: SearchScope.Vault,
			folderId: "root",
			createdAt: 1000,
		});
		expect(readSmartFolders()).toEqual(after);
	});

	it("rejects a blank query (nothing to save)", () => {
		expect(save([], { query: "   " })).toEqual([]);
		expect(readSmartFolders()).toEqual([]);
	});

	it("falls back to the trimmed query when the name is blank", () => {
		const after = save([], { name: "  ", query: "  invoices  " });
		expect(after[0]?.name).toBe("invoices");
		expect(after[0]?.query).toBe("invoices");
	});

	it("collapses an exact duplicate", () => {
		const once = save([]);
		const twice = save(once, { id: "sf_2" });
		expect(twice).toHaveLength(1);
		expect(twice[0]?.id).toBe("sf_1");
	});

	it("keeps a same-name search with a different scope", () => {
		const once = save([]);
		const twice = save(once, { id: "sf_2", scope: SearchScope.ActiveFolder });
		expect(twice).toHaveLength(2);
	});

	it("FIFO-evicts at the cap", () => {
		let list: SmartFolder[] = [];
		for (let i = 0; i < MAX_SMART_FOLDERS + 5; i++) {
			list = saveSmartFolder(list, {
				name: `q${i}`,
				query: `q${i}`,
				scope: SearchScope.Vault,
				folderId: "root",
				now: i,
				id: `sf_${i}`,
			});
		}
		expect(list).toHaveLength(MAX_SMART_FOLDERS);
		expect(list[0]?.id).toBe("sf_5");
		expect(list[list.length - 1]?.id).toBe(`sf_${MAX_SMART_FOLDERS + 4}`);
	});

	it("deletes by id and is a no-op for an unknown id", () => {
		const saved = save([]);
		expect(deleteSmartFolder(saved, "sf_1")).toEqual([]);
		expect(deleteSmartFolder(saved, "ghost")).toEqual(saved);
		expect(readSmartFolders()).toEqual([]);
	});

	it("renames, normalizes, and no-ops on an unchanged name", () => {
		const saved = save([]);
		const renamed = renameSmartFolder(saved, "sf_1", "  Brand assets  ");
		expect(renamed[0]?.name).toBe("Brand assets");
		expect(renameSmartFolder(renamed, "sf_1", "Brand assets")).toEqual(renamed);
		expect(readSmartFolders()[0]?.name).toBe("Brand assets");
	});

	it("scopes the blob per vault key", () => {
		saveSmartFolder(
			[],
			{
				name: "A",
				query: "a",
				scope: SearchScope.Vault,
				folderId: "root",
				now: 1,
				id: "a",
			},
			"vaultA",
		);
		expect(readSmartFolders("vaultA")).toHaveLength(1);
		expect(readSmartFolders("vaultB")).toEqual([]);
		expect(readSmartFolders()).toEqual([]);
	});

	it("degrades a corrupted blob to empty", () => {
		localStorage.setItem("brainstorm.files.smartFolders.v1", "{not an array}");
		expect(readSmartFolders()).toEqual([]);
		localStorage.setItem(
			"brainstorm.files.smartFolders.v1",
			JSON.stringify([{ id: "x", name: "", query: "q", scope: "vault", folderId: "root" }]),
		);
		expect(readSmartFolders()).toEqual([]);
	});

	it("normalizeSmartFolderName clamps overlong names", () => {
		const long = "x".repeat(500);
		expect(normalizeSmartFolderName(long, "q").length).toBe(120);
	});
});
