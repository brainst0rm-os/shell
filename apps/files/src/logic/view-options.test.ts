// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { TileSize, ViewMode } from "../view-mode";
import { GroupKey } from "./group";
import { ListColumn } from "./list-columns";
import { SortDirection, SortKey } from "./sort";
import {
	DEFAULT_VIEW_OPTIONS,
	type ViewOptions,
	applyViewOptionsToAllFolders,
	readViewOptions,
	writeViewOptions,
} from "./view-options";

const OPTS: ViewOptions = {
	mode: ViewMode.Grid,
	sortKey: SortKey.Name,
	sortDirection: SortDirection.Desc,
	groupKey: GroupKey.Type,
	tileSize: TileSize.Small,
	columns: [ListColumn.Kind, ListColumn.Modified],
};

afterEach(() => localStorage.clear());

describe("per-folder view options (9.8.11)", () => {
	it("falls back to defaults when nothing is stored", () => {
		expect(readViewOptions("f1")).toEqual(DEFAULT_VIEW_OPTIONS);
	});

	it("remembers options per folder", () => {
		writeViewOptions("f1", OPTS);
		expect(readViewOptions("f1")).toEqual(OPTS);
		expect(readViewOptions("f2")).toEqual(DEFAULT_VIEW_OPTIONS);
	});

	it("persists the icon-list mode (9.8.10)", () => {
		writeViewOptions("f1", { ...OPTS, mode: ViewMode.IconList });
		expect(readViewOptions("f1").mode).toBe(ViewMode.IconList);
	});

	it("apply-to-all sets the default and drops per-folder overrides", () => {
		writeViewOptions("f1", { ...OPTS, mode: ViewMode.Gallery });
		applyViewOptionsToAllFolders(OPTS);
		expect(readViewOptions("f1")).toEqual(OPTS);
		expect(readViewOptions("anything")).toEqual(OPTS);
	});

	it("a corrupted blob degrades to defaults", () => {
		localStorage.setItem("brainstorm.files.viewOptions.v1", "{not json");
		expect(readViewOptions("f1")).toEqual(DEFAULT_VIEW_OPTIONS);
		localStorage.setItem(
			"brainstorm.files.viewOptions.v1",
			JSON.stringify({ folders: { f1: { mode: "hologram" } } }),
		);
		expect(readViewOptions("f1")).toEqual(DEFAULT_VIEW_OPTIONS);
	});
});

describe("view options vault scoping (BUG 2 — cross-vault root collision)", () => {
	const ROOT = "brainstorm/root-folder/v1";

	it("a vault-scoped blob does not leak into another vault", () => {
		writeViewOptions(ROOT, OPTS, "vaultA");
		// vaultB's root sees its own (empty → defaults), NOT vault A's options.
		expect(readViewOptions(ROOT, "vaultB")).toEqual(DEFAULT_VIEW_OPTIONS);
		expect(readViewOptions(ROOT, "vaultA")).toEqual(OPTS);
	});

	it("apply-to-all is also vault-scoped", () => {
		applyViewOptionsToAllFolders(OPTS, "vaultA");
		expect(readViewOptions("anything", "vaultA")).toEqual(OPTS);
		expect(readViewOptions("anything", "vaultB")).toEqual(DEFAULT_VIEW_OPTIONS);
	});

	it("scoped + legacy unscoped blobs are independent keys", () => {
		writeViewOptions(ROOT, OPTS); // legacy unscoped
		writeViewOptions(ROOT, { ...OPTS, mode: ViewMode.Gallery }, "vaultA");
		expect(readViewOptions(ROOT)).toEqual(OPTS);
		expect(readViewOptions(ROOT, "vaultA").mode).toBe(ViewMode.Gallery);
	});

	it("a missing vaultKey degrades to the legacy unscoped blob (backward-tolerant)", () => {
		writeViewOptions(ROOT, OPTS); // written without a key
		expect(readViewOptions(ROOT, undefined)).toEqual(OPTS);
	});
});

describe("view options forward/backward compat (9.8.11 tail)", () => {
	it("a blob stored before tileSize/columns existed keeps its options", () => {
		localStorage.setItem(
			"brainstorm.files.viewOptions.v1",
			JSON.stringify({
				folders: {
					f1: { mode: "grid", sortKey: "name", sortDirection: "desc", groupKey: "type" },
				},
			}),
		);
		const options = readViewOptions("f1");
		expect(options.mode).toBe(ViewMode.Grid);
		expect(options.tileSize).toBe(DEFAULT_VIEW_OPTIONS.tileSize);
		expect(options.columns).toEqual(DEFAULT_VIEW_OPTIONS.columns);
	});

	it("round-trips tileSize + columns", () => {
		writeViewOptions("f1", {
			...DEFAULT_VIEW_OPTIONS,
			tileSize: TileSize.Large,
			columns: [ListColumn.Size],
		});
		const options = readViewOptions("f1");
		expect(options.tileSize).toBe(TileSize.Large);
		expect(options.columns).toEqual([ListColumn.Size]);
	});

	it("round-trips the icon-list mode (9.8.10)", () => {
		writeViewOptions("f1", { ...DEFAULT_VIEW_OPTIONS, mode: ViewMode.IconList });
		expect(readViewOptions("f1").mode).toBe(ViewMode.IconList);
	});
});
