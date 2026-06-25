/**
 * ColumnsNode / ColumnNode — a side-by-side multi-column layout.
 *
 *   ColumnsNode  → flex row container (one top-level block).
 *     ColumnNode  → a flex child holding arbitrary blocks. Each column
 *                   owns its `__flex` grow factor; the resizer (see
 *                   columns-plugin) drags it. Columns stack on narrow
 *                   widths via CSS `flex-wrap`.
 *
 * Both are ElementNodes (they hold block children), serialise their
 * structure for free, and never auto-collapse to an inline.
 */

import {
	type EditorConfig,
	ElementNode,
	type LexicalNode,
	type SerializedElementNode,
} from "lexical";

export const COLUMNS_NODE_TYPE = "columns";
export const COLUMN_NODE_TYPE = "column";
const VERSION = 1 as const;

export type SerializedColumnsNode = SerializedElementNode & {
	type: typeof COLUMNS_NODE_TYPE;
	version: typeof VERSION;
};

export type SerializedColumnNode = SerializedElementNode & {
	type: typeof COLUMN_NODE_TYPE;
	version: typeof VERSION;
	flex: number;
};

function clampFlex(n: unknown): number {
	const v = typeof n === "number" && Number.isFinite(n) ? n : 1;
	// Keep a column from collapsing to nothing or hogging everything.
	return Math.min(8, Math.max(0.25, v));
}

export class ColumnsNode extends ElementNode {
	static override getType(): string {
		return COLUMNS_NODE_TYPE;
	}

	static override clone(node: ColumnsNode): ColumnsNode {
		return new ColumnsNode(node.__key);
	}

	override createDOM(_config: EditorConfig): HTMLElement {
		const el = document.createElement("div");
		el.className = "notes__columns";
		return el;
	}

	override updateDOM(): false {
		return false;
	}

	static override importJSON(_s: SerializedColumnsNode): ColumnsNode {
		return new ColumnsNode();
	}

	override exportJSON(): SerializedColumnsNode {
		return { ...super.exportJSON(), type: COLUMNS_NODE_TYPE, version: VERSION };
	}

	override canBeEmpty(): boolean {
		return false;
	}

	override canIndent(): boolean {
		return false;
	}
}

export class ColumnNode extends ElementNode {
	__flex: number;

	static override getType(): string {
		return COLUMN_NODE_TYPE;
	}

	static override clone(node: ColumnNode): ColumnNode {
		return new ColumnNode(node.__flex, node.__key);
	}

	constructor(flex = 1, key?: string) {
		super(key);
		this.__flex = clampFlex(flex);
	}

	getFlex(): number {
		return this.getLatest().__flex;
	}

	setFlex(flex: number): void {
		this.getWritable().__flex = clampFlex(flex);
	}

	override createDOM(_config: EditorConfig): HTMLElement {
		const el = document.createElement("div");
		el.className = "notes__column";
		el.style.flexGrow = String(this.__flex);
		return el;
	}

	override updateDOM(prev: ColumnNode, dom: HTMLElement): boolean {
		if (prev.__flex !== this.__flex) dom.style.flexGrow = String(this.__flex);
		return false;
	}

	static override importJSON(s: SerializedColumnNode): ColumnNode {
		return new ColumnNode(clampFlex(s.flex));
	}

	override exportJSON(): SerializedColumnNode {
		return {
			...super.exportJSON(),
			type: COLUMN_NODE_TYPE,
			version: VERSION,
			flex: this.__flex,
		};
	}

	override canBeEmpty(): boolean {
		return true;
	}

	override canIndent(): boolean {
		return false;
	}
}

export function $createColumnsNode(): ColumnsNode {
	return new ColumnsNode();
}

export function $createColumnNode(flex = 1): ColumnNode {
	return new ColumnNode(flex);
}

export function $isColumnsNode(node?: LexicalNode | null): node is ColumnsNode {
	return node instanceof ColumnsNode;
}

export function $isColumnNode(node?: LexicalNode | null): node is ColumnNode {
	return node instanceof ColumnNode;
}
