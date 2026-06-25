import { describe, expect, it } from "vitest";
import { type Entity, FILE_TYPE, FOLDER_TYPE } from "../types/entity";
import { FolderTree } from "./folder-tree";
import {
	ScopeFlipAction,
	SearchScope,
	flipScope,
	foldQuery,
	matchesQuery,
	runSearch,
} from "./search";

function fld(id: string, name: string, members: string[]): Entity {
	return {
		id,
		type: FOLDER_TYPE,
		properties: { name, members },
		createdAt: 0,
		updatedAt: 0,
		deletedAt: null,
	};
}

function fil(id: string, name: string): Entity {
	return {
		id,
		type: FILE_TYPE,
		properties: { name, mime: "text/plain", size: 0 },
		createdAt: 0,
		updatedAt: 0,
		deletedAt: null,
	};
}

function tree(): FolderTree {
	const t = new FolderTree();
	t.applySnapshot([
		fld("root", "(vault)", ["inbox", "designs"]),
		fld("inbox", "Inbox", ["fil_a", "fil_b"]),
		fld("designs", "Designs", ["fld_drops", "fil_c"]),
		fld("fld_drops", "Screenshot-drops", ["fil_d"]),
		fil("fil_a", "report-final.pdf"),
		fil("fil_b", "résumé.docx"),
		fil("fil_c", "logo.png"),
		fil("fil_d", "screenshot-2026-05-12.png"),
	]);
	return t;
}

describe("foldQuery + matchesQuery", () => {
	it("folds case + diacritics + treats empty query as match-all", () => {
		expect(foldQuery("Café")).toBe(foldQuery("cafe"));
		expect(matchesQuery("RÉSUMÉ.pdf", foldQuery("resume"))).toBe(true);
		expect(matchesQuery("anything", "")).toBe(true);
	});

	it("matches substrings (not just prefixes)", () => {
		expect(matchesQuery("screenshot-drop.png", foldQuery("drop"))).toBe(true);
	});
});

describe("runSearch — active folder scope", () => {
	it("returns only matching members of the named folder", () => {
		const out = runSearch({
			tree: tree(),
			folderId: "inbox",
			query: "report",
			scope: SearchScope.ActiveFolder,
		});
		expect(out.map((e) => e.id)).toEqual(["fil_a"]);
	});

	it("empty query returns every member", () => {
		const out = runSearch({
			tree: tree(),
			folderId: "inbox",
			query: "",
			scope: SearchScope.ActiveFolder,
		});
		expect(out.map((e) => e.id)).toEqual(["fil_a", "fil_b"]);
	});
});

describe("runSearch — subfolder / vault scope", () => {
	it("walks descendants and returns every match", () => {
		const out = runSearch({
			tree: tree(),
			folderId: "root",
			query: "screenshot",
			scope: SearchScope.Subfolders,
		});
		expect(out.map((e) => e.id).sort()).toEqual(["fil_d", "fld_drops"]);
	});

	it("vault scope from root matches everything by substring", () => {
		const out = runSearch({
			tree: tree(),
			folderId: "root",
			query: "pdf",
			scope: SearchScope.Vault,
		});
		expect(out.map((e) => e.id)).toEqual(["fil_a"]);
	});

	it("excludes soft-deleted entities", () => {
		const t = tree();
		t.softDelete("fil_a");
		const out = runSearch({
			tree: t,
			folderId: "root",
			query: "report",
			scope: SearchScope.Subfolders,
		});
		expect(out).toEqual([]);
	});

	it("diacritic fold across scope walker", () => {
		const out = runSearch({
			tree: tree(),
			folderId: "root",
			query: "resume",
			scope: SearchScope.Vault,
		});
		expect(out.map((e) => e.id)).toEqual(["fil_b"]);
	});
});

describe("flipScope (9.8.9 — scope chip → launcher handoff)", () => {
	it("this-folder flips to subfolders regardless of the shell service", () => {
		expect(flipScope(SearchScope.ActiveFolder, true)).toEqual({
			action: ScopeFlipAction.SetScope,
			scope: SearchScope.Subfolders,
		});
		expect(flipScope(SearchScope.ActiveFolder, false)).toEqual({
			action: ScopeFlipAction.SetScope,
			scope: SearchScope.Subfolders,
		});
	});

	it("subfolders flips to the launcher when the shell exposes ui.openSearch", () => {
		expect(flipScope(SearchScope.Subfolders, true)).toEqual({
			action: ScopeFlipAction.LauncherHandoff,
		});
	});

	it("subfolders falls back to the local vault walk without the service", () => {
		expect(flipScope(SearchScope.Subfolders, false)).toEqual({
			action: ScopeFlipAction.SetScope,
			scope: SearchScope.Vault,
		});
	});

	it("vault (a re-run smart folder) cycles back to this-folder", () => {
		expect(flipScope(SearchScope.Vault, true)).toEqual({
			action: ScopeFlipAction.SetScope,
			scope: SearchScope.ActiveFolder,
		});
		expect(flipScope(SearchScope.Vault, false)).toEqual({
			action: ScopeFlipAction.SetScope,
			scope: SearchScope.ActiveFolder,
		});
	});
});
