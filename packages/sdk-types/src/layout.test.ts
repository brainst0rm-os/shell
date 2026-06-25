import { describe, expect, it } from "vitest";
import {
	AppLayoutIssueCode,
	type AppLayoutManifestEntry,
	CHROME_KINDS,
	ChromeKind,
	LAYOUT_CELL_KINDS,
	LAYOUT_CONTEXTS,
	LAYOUT_MODES,
	LAYOUT_TYPE_URL,
	type LayoutCell,
	LayoutCellKind,
	LayoutContext,
	type LayoutDef,
	LayoutIssueCode,
	LayoutMode,
	areAppLayoutsValid,
	collectCellIds,
	effectiveReadingOrder,
	isChromeKind,
	isLayoutCellKind,
	isLayoutContext,
	isLayoutMode,
	isValidLayout,
	validateAppLayouts,
	validateLayout,
} from "./layout";

const scope = { kind: "type", target: "io.example/Doc/v1" } as const;

function layout(over: Partial<LayoutDef> & { cells: LayoutCell[] }): LayoutDef {
	return { mode: LayoutMode.Stacked, scope, context: LayoutContext.Full, ...over };
}

describe("constants + frozen tables", () => {
	it("pins the canonical type url", () => {
		expect(LAYOUT_TYPE_URL).toBe("brainstorm/Layout/v1");
	});

	it("freezes the enumerated tables and they mirror the enums", () => {
		for (const t of [LAYOUT_MODES, LAYOUT_CONTEXTS, LAYOUT_CELL_KINDS, CHROME_KINDS]) {
			expect(Object.isFrozen(t)).toBe(true);
		}
		expect([...LAYOUT_MODES].sort()).toEqual([...Object.values(LayoutMode)].sort());
		expect([...LAYOUT_CONTEXTS].sort()).toEqual([...Object.values(LayoutContext)].sort());
		expect([...LAYOUT_CELL_KINDS].sort()).toEqual([...Object.values(LayoutCellKind)].sort());
		expect([...CHROME_KINDS].sort()).toEqual([...Object.values(ChromeKind)].sort());
	});
});

describe("type guards", () => {
	it("accept valid members, reject junk + non-strings", () => {
		expect(isLayoutMode(LayoutMode.Freeform)).toBe(true);
		expect(isLayoutMode("nope")).toBe(false);
		expect(isLayoutMode(7)).toBe(false);
		expect(isLayoutContext(LayoutContext.Card)).toBe(true);
		expect(isLayoutContext("everywhere")).toBe(false);
		expect(isLayoutCellKind(LayoutCellKind.Group)).toBe(true);
		expect(isLayoutCellKind(null)).toBe(false);
		expect(isChromeKind(ChromeKind.ActionBar)).toBe(true);
		expect(isChromeKind("io.example/burndown")).toBe(false);
	});
});

describe("collectCellIds", () => {
	it("walks groups recursively in document (pre-)order", () => {
		const cells: LayoutCell[] = [
			{ id: "a", kind: LayoutCellKind.Divider },
			{
				id: "g",
				kind: LayoutCellKind.Group,
				cells: [
					{ id: "g1", kind: LayoutCellKind.Property, property: "title" },
					{
						id: "g2",
						kind: LayoutCellKind.Group,
						cells: [{ id: "g2a", kind: LayoutCellKind.Divider }],
					},
				],
			},
			{ id: "z", kind: LayoutCellKind.Text, text: "end" },
		];
		expect(collectCellIds(cells)).toEqual(["a", "g", "g1", "g2", "g2a", "z"]);
	});
});

describe("effectiveReadingOrder", () => {
	const cells: LayoutCell[] = [
		{ id: "c", kind: LayoutCellKind.Property, property: "c", grid: { col: 1, row: 1 } },
		{ id: "a", kind: LayoutCellKind.Property, property: "a", grid: { col: 0, row: 0 } },
		{ id: "b", kind: LayoutCellKind.Property, property: "b", grid: { col: 1, row: 0 } },
	];

	it("stacked → document order", () => {
		expect(effectiveReadingOrder(layout({ mode: LayoutMode.Stacked, cells }))).toEqual([
			"c",
			"a",
			"b",
		]);
	});

	it("grid → row-major (row then col), document order as the tiebreak", () => {
		expect(effectiveReadingOrder(layout({ mode: LayoutMode.Grid, cells }))).toEqual(["a", "b", "c"]);
	});

	it("grid → placed cells precede unplaced; unplaced keep document order", () => {
		const mixed: LayoutCell[] = [
			{ id: "x", kind: LayoutCellKind.Divider },
			{ id: "y", kind: LayoutCellKind.Property, property: "y", grid: { col: 0, row: 0 } },
			{ id: "z", kind: LayoutCellKind.Divider },
		];
		expect(effectiveReadingOrder(layout({ mode: LayoutMode.Grid, cells: mixed }))).toEqual([
			"y",
			"x",
			"z",
		]);
	});

	it("an explicit readingOrder overrides any mode", () => {
		expect(
			effectiveReadingOrder(layout({ mode: LayoutMode.Grid, cells, readingOrder: ["b", "c", "a"] })),
		).toEqual(["b", "c", "a"]);
	});

	it("freeform → the explicit order; degenerate doc-order fallback never throws", () => {
		expect(effectiveReadingOrder(layout({ mode: LayoutMode.Freeform, cells }))).toEqual([
			"c",
			"a",
			"b",
		]);
	});
});

describe("validateLayout", () => {
	const codes = (def: LayoutDef) => validateLayout(def).map((i) => i.code);

	it("a well-formed stacked layout is valid", () => {
		const def = layout({
			cells: [
				{ id: "title", kind: LayoutCellKind.Property, property: "title" },
				{ id: "bar", kind: LayoutCellKind.Chrome, chrome: ChromeKind.ActionBar },
				{
					id: "grp",
					kind: LayoutCellKind.Group,
					cells: [{ id: "body", kind: LayoutCellKind.Block, block: "io.x/doc" }],
				},
			],
		});
		expect(validateLayout(def)).toEqual([]);
		expect(isValidLayout(def)).toBe(true);
	});

	it("flags bad mode / context", () => {
		const c = codes({
			mode: "diagonal" as LayoutMode,
			context: "hologram" as LayoutContext,
			scope,
			cells: [{ id: "a", kind: LayoutCellKind.Divider }],
		});
		expect(c).toContain(LayoutIssueCode.InvalidMode);
		expect(c).toContain(LayoutIssueCode.InvalidContext);
	});

	it("a null context is valid — it is the any-context wildcard (doc 27 §Resolution)", () => {
		const def = layout({ context: null, cells: [{ id: "a", kind: LayoutCellKind.Divider }] });
		expect(validateLayout(def).map((i) => i.code)).not.toContain(LayoutIssueCode.InvalidContext);
		expect(isValidLayout(def)).toBe(true);
	});

	it("flags empty + duplicate cell ids (including nested)", () => {
		const c = codes(
			layout({
				cells: [
					{ id: "", kind: LayoutCellKind.Divider },
					{ id: "dup", kind: LayoutCellKind.Divider },
					{
						id: "g",
						kind: LayoutCellKind.Group,
						cells: [{ id: "dup", kind: LayoutCellKind.Divider }],
					},
				],
			}),
		);
		expect(c).toContain(LayoutIssueCode.EmptyCellId);
		expect(c).toContain(LayoutIssueCode.DuplicateCellId);
	});

	it("flags per-kind structural gaps", () => {
		const c = codes(
			layout({
				cells: [
					{ id: "p", kind: LayoutCellKind.Property, property: "" },
					{ id: "b", kind: LayoutCellKind.Block, block: "" },
					{ id: "ch", kind: LayoutCellKind.Chrome, chrome: "io.x/burndown" as ChromeKind },
					{ id: "t", kind: LayoutCellKind.Text },
					{ id: "g", kind: LayoutCellKind.Group, cells: [] },
				],
			}),
		);
		expect(c).toEqual(
			expect.arrayContaining([
				LayoutIssueCode.PropertyCellMissingProperty,
				LayoutIssueCode.BlockCellMissingBlock,
				LayoutIssueCode.ChromeCellInvalidKind,
				LayoutIssueCode.TextCellMissingText,
				LayoutIssueCode.GroupCellEmpty,
			]),
		);
	});

	it("freeform without a readingOrder is rejected; with a complete one it passes", () => {
		const cells: LayoutCell[] = [
			{
				id: "a",
				kind: LayoutCellKind.Property,
				property: "a",
				freeform: { x: 0, y: 0, width: 10, height: 4 },
			},
			{ id: "b", kind: LayoutCellKind.Divider },
		];
		expect(codes(layout({ mode: LayoutMode.Freeform, cells }))).toContain(
			LayoutIssueCode.ReadingOrderRequired,
		);
		expect(
			validateLayout(layout({ mode: LayoutMode.Freeform, cells, readingOrder: ["a", "b"] })),
		).toEqual([]);
	});

	it("a readingOrder must be an exact permutation of all cell ids", () => {
		const cells: LayoutCell[] = [
			{ id: "a", kind: LayoutCellKind.Divider },
			{ id: "b", kind: LayoutCellKind.Group, cells: [{ id: "b1", kind: LayoutCellKind.Divider }] },
		];
		const c = codes(layout({ cells, readingOrder: ["a", "a", "ghost"] }));
		expect(c).toContain(LayoutIssueCode.ReadingOrderUnknownId); // "ghost"
		expect(c).toContain(LayoutIssueCode.ReadingOrderDuplicateId); // "a" twice
		expect(c).toContain(LayoutIssueCode.ReadingOrderMissingId); // "b" + "b1" omitted
	});
});

describe("validateAppLayouts", () => {
	const OWNED = ["io.x/Doc/v1", "io.x/Note/v1"];
	const goodConfig = {
		mode: LayoutMode.Stacked,
		cells: [{ id: "t", kind: LayoutCellKind.Divider }] as LayoutCell[],
	};
	const entry = (over: Partial<AppLayoutManifestEntry> = {}): AppLayoutManifestEntry => ({
		type: "io.x/Doc/v1",
		context: LayoutContext.Full,
		config: goodConfig,
		...over,
	});
	const codes = (e: AppLayoutManifestEntry[], owned = OWNED) =>
		validateAppLayouts(e, owned).map((i) => i.code);

	it("well-formed app layouts validate", () => {
		const entries = [entry(), entry({ type: "io.x/Note/v1", context: LayoutContext.Card })];
		expect(validateAppLayouts(entries, OWNED)).toEqual([]);
		expect(areAppLayoutsValid(entries, OWNED)).toBe(true);
	});

	it("flags an empty type", () => {
		expect(codes([entry({ type: "" })])).toContain(AppLayoutIssueCode.EmptyType);
	});

	it("enforces the doc-27 rule: an app cannot ship a layout for a type it does not introduce", () => {
		const issues = validateAppLayouts([entry({ type: "io.other/Task/v1" })], OWNED);
		const foreign = issues.find((i) => i.code === AppLayoutIssueCode.ForeignType);
		expect(foreign?.type).toBe("io.other/Task/v1");
	});

	it("flags an unknown context once (not double-counted as InvalidConfig)", () => {
		const c = codes([entry({ context: "hologram" as LayoutContext })]);
		expect(c.filter((x) => x === AppLayoutIssueCode.InvalidContext)).toHaveLength(1);
		expect(c).not.toContain(AppLayoutIssueCode.InvalidConfig);
	});

	it("accepts a null (any) context", () => {
		expect(validateAppLayouts([entry({ context: null })], OWNED)).toEqual([]);
	});

	it("flags a duplicate (type, context) pair — including null", () => {
		expect(codes([entry(), entry()])).toContain(AppLayoutIssueCode.DuplicateTypeContext);
		expect(codes([entry({ context: null }), entry({ context: null })])).toContain(
			AppLayoutIssueCode.DuplicateTypeContext,
		);
		// Same type, different context → not a duplicate.
		expect(codes([entry(), entry({ context: LayoutContext.Card })])).not.toContain(
			AppLayoutIssueCode.DuplicateTypeContext,
		);
	});

	it("flags a missing config", () => {
		expect(
			codes([entry({ config: undefined as unknown as AppLayoutManifestEntry["config"] })]),
		).toContain(AppLayoutIssueCode.InvalidConfig);
	});

	it("a malformed config surfaces as InvalidConfig carrying the underlying LayoutIssue", () => {
		const bad = entry({
			config: {
				mode: LayoutMode.Freeform,
				cells: [{ id: "a", kind: LayoutCellKind.Divider }],
				// freeform requires an explicit readingOrder
			},
		});
		const issue = validateAppLayouts([bad], OWNED).find(
			(i) => i.code === AppLayoutIssueCode.InvalidConfig,
		);
		expect(issue?.layoutIssue?.code).toBe(LayoutIssueCode.ReadingOrderRequired);
		expect(issue?.entryIndex).toBe(0);
	});
});
