// @vitest-environment jsdom
import { createHeadlessEditor } from "@lexical/headless";
import {
	$createTableNodeWithDimensions,
	$isTableNode,
	TableCellHeaderStates,
	TableCellNode,
	TableNode,
	TableRowNode,
} from "@lexical/table";
import {
	$createTextNode,
	$getRoot,
	$isParagraphNode,
	type ElementNode,
	type LexicalEditor,
} from "lexical";
import { beforeEach, describe, expect, it } from "vitest";
import {
	TableAxis,
	TableEdge,
	deleteTable,
	deleteTableLine,
	fillDownColumn,
	insertTableLine,
	moveTableColumn,
	sortTableBySelectedColumn,
	toggleHeaderRow,
} from "./table-ops";

function makeEditor(): LexicalEditor {
	const editor = createHeadlessEditor({
		namespace: "t",
		nodes: [TableNode, TableRowNode, TableCellNode],
		onError: (e) => {
			throw e;
		},
	});
	editor.update(
		() => {
			const table = $createTableNodeWithDimensions(3, 3, true);
			$getRoot().append(table);
			const cell = table.getFirstChild<TableRowNode>()?.getFirstChild();
			cell?.selectStart();
		},
		{ discrete: true },
	);
	return editor;
}

function flush(editor: LexicalEditor): void {
	editor.update(() => {}, { discrete: true });
}

function dims(editor: LexicalEditor): { rows: number; cols: number } {
	let rows = 0;
	let cols = 0;
	editor.getEditorState().read(() => {
		const table = $getRoot().getFirstChild();
		if (!table || !$isTableNode(table)) return;
		rows = table.getChildrenSize();
		const firstRow = table.getFirstChild<TableRowNode>();
		cols = firstRow ? firstRow.getChildrenSize() : 0;
	});
	return { rows, cols };
}

describe("table-ops", () => {
	let editor: LexicalEditor;
	beforeEach(() => {
		editor = makeEditor();
	});

	it("starts as a 3×3 table", () => {
		expect(dims(editor)).toEqual({ rows: 3, cols: 3 });
	});

	it("inserts a row below the caret", () => {
		insertTableLine(editor, TableAxis.Row, TableEdge.After);
		flush(editor);
		expect(dims(editor).rows).toBe(4);
	});

	it("inserts a column to the right of the caret", () => {
		insertTableLine(editor, TableAxis.Column, TableEdge.After);
		flush(editor);
		expect(dims(editor).cols).toBe(4);
	});

	it("deletes the caret's row and column", () => {
		deleteTableLine(editor, TableAxis.Row);
		flush(editor);
		expect(dims(editor).rows).toBe(2);
		deleteTableLine(editor, TableAxis.Column);
		flush(editor);
		expect(dims(editor).cols).toBe(2);
	});

	it("toggles the header row on and off", () => {
		const headerBits = (): number[] => {
			const bits: number[] = [];
			editor.getEditorState().read(() => {
				const table = $getRoot().getFirstChild();
				if (!table || !$isTableNode(table)) return;
				const row = table.getFirstChild<TableRowNode>();
				for (const cell of row?.getChildren() ?? []) {
					bits.push((cell as TableCellNode).getHeaderStyles() & TableCellHeaderStates.ROW);
				}
			});
			return bits;
		};
		// Built with includeHeaders → first row already a ROW header.
		expect(headerBits().every((b) => b !== 0)).toBe(true);
		toggleHeaderRow(editor);
		flush(editor);
		expect(headerBits().every((b) => b === 0)).toBe(true);
		toggleHeaderRow(editor);
		flush(editor);
		expect(headerBits().every((b) => b !== 0)).toBe(true);
	});

	it("deletes the whole table, leaving a paragraph", () => {
		deleteTable(editor);
		flush(editor);
		editor.getEditorState().read(() => {
			const first = $getRoot().getFirstChild();
			expect(first && $isParagraphNode(first)).toBe(true);
			expect($isTableNode(first)).toBe(false);
		});
	});

	it("survives a serialize → parse round-trip", () => {
		insertTableLine(editor, TableAxis.Row, TableEdge.After);
		flush(editor);
		const json = JSON.stringify(editor.getEditorState().toJSON());
		const restored = createHeadlessEditor({
			namespace: "t2",
			nodes: [TableNode, TableRowNode, TableCellNode],
			onError: (e) => {
				throw e;
			},
		});
		restored.setEditorState(restored.parseEditorState(JSON.parse(json)));
		expect(dims(restored)).toEqual({ rows: 4, cols: 3 });
	});
});

describe("sortTableBySelectedColumn", () => {
	/** Build a headerless table from a grid of cell texts and park the caret
	 *  in the first cell of `selectCol`. */
	function buildTable(editor: LexicalEditor, grid: string[][], selectCol: number): void {
		editor.update(
			() => {
				$getRoot().clear();
				const table = $createTableNodeWithDimensions(grid.length, grid[0]?.length ?? 0, false);
				$getRoot().append(table);
				const rows = table.getChildren<TableRowNode>();
				rows.forEach((row, r) => {
					row.getChildren<TableCellNode>().forEach((cell, c) => {
						const para = cell.getFirstChild<ElementNode>();
						para?.append($createTextNode(grid[r]?.[c] ?? ""));
					});
				});
				rows[0]?.getChildren<TableCellNode>()[selectCol]?.selectStart();
			},
			{ discrete: true },
		);
	}

	function columnTexts(editor: LexicalEditor, col: number): string[] {
		const out: string[] = [];
		editor.getEditorState().read(() => {
			const table = $getRoot().getFirstChild();
			if (!table || !$isTableNode(table)) return;
			for (const row of table.getChildren<TableRowNode>()) {
				out.push(row.getChildren()[col]?.getTextContent().trim() ?? "");
			}
		});
		return out;
	}

	it("sorts body rows ascending by the selected column (numeric)", () => {
		const editor = makeEditor();
		buildTable(
			editor,
			[
				["3", "x"],
				["1", "y"],
				["2", "z"],
			],
			0,
		);
		sortTableBySelectedColumn(editor, true);
		flush(editor);
		expect(columnTexts(editor, 0)).toEqual(["1", "2", "3"]);
		// The whole row travels with its key column.
		expect(columnTexts(editor, 1)).toEqual(["y", "z", "x"]);
	});

	it("sorts descending when ascending is false", () => {
		const editor = makeEditor();
		buildTable(editor, [["3"], ["1"], ["2"]], 0);
		sortTableBySelectedColumn(editor, false);
		flush(editor);
		expect(columnTexts(editor, 0)).toEqual(["3", "2", "1"]);
	});

	it("sorts non-numeric columns by locale string order", () => {
		const editor = makeEditor();
		buildTable(editor, [["banana"], ["apple"], ["cherry"]], 0);
		sortTableBySelectedColumn(editor, true);
		flush(editor);
		expect(columnTexts(editor, 0)).toEqual(["apple", "banana", "cherry"]);
	});

	it("moves the selected column right, swapping with its neighbour", () => {
		const editor = makeEditor();
		buildTable(
			editor,
			[
				["a1", "b1", "c1"],
				["a2", "b2", "c2"],
			],
			0,
		);
		moveTableColumn(editor, true);
		flush(editor);
		// Column 0 (a*) and column 1 (b*) swap in every row.
		expect(columnTexts(editor, 0)).toEqual(["b1", "b2"]);
		expect(columnTexts(editor, 1)).toEqual(["a1", "a2"]);
		expect(columnTexts(editor, 2)).toEqual(["c1", "c2"]);
	});

	it("is a no-op moving the first column left (edge)", () => {
		const editor = makeEditor();
		buildTable(editor, [["a", "b"]], 0);
		moveTableColumn(editor, false);
		flush(editor);
		expect(columnTexts(editor, 0)).toEqual(["a"]);
		expect(columnTexts(editor, 1)).toEqual(["b"]);
	});

	it("fills the selected cell's value down its column", () => {
		const editor = makeEditor();
		buildTable(
			editor,
			[
				["seed", "a"],
				["", "b"],
				["", "c"],
			],
			0,
		);
		fillDownColumn(editor);
		flush(editor);
		expect(columnTexts(editor, 0)).toEqual(["seed", "seed", "seed"]);
		// Other columns are untouched.
		expect(columnTexts(editor, 1)).toEqual(["a", "b", "c"]);
	});
});
