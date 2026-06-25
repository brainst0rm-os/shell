/**
 * TableColumnResizePlugin — drag-to-resize table columns (B11.3).
 *
 * Both the hover affordance AND the drag-start run off CAPTURE-phase document
 * listeners, NOT React's `onMouseDown`: sibling editor plugins (marquee /
 * block-selection) stop mousedown propagation before it reaches React's
 * delegated root, and a thin floating handle is fragile to hit-test. So the
 * drag starts when a `mousedown` lands within {@link RESIZE_ZONE} of a table
 * cell's right edge — read straight off the cell DOM target, no handle to
 * click. A cosmetic handle still renders on hover for discoverability.
 *
 * The column width is applied once on mouse-up (a single Yjs transaction via
 * `setTableColumnWidth`), seeded from the measured rendered widths so a
 * never-sized table picks up sensible defaults.
 */

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $isTableNode } from "@lexical/table";
import { $findMatchingParent } from "@lexical/utils";
import { $getNearestNodeFromDOMNode } from "lexical";
import { useEffect, useState } from "react";
import { MIN_TABLE_COLUMN_WIDTH, setTableColumnWidth } from "./table-ops";

const RESIZE_ZONE = 9;
const HANDLE_CLASS = "bs-editor__table-col-resizer";
/** Body class that forces the `col-resize` cursor while hovering/dragging a
 *  column edge — the cosmetic handle is `pointer-events: none`, so its own
 *  `cursor` never wins over the contenteditable's text cursor; a body-level
 *  rule does. */
const CURSOR_CLASS = "bs-table-col-resizing";

type HandleState = { x: number; top: number; height: number; dragging: boolean };

function measureColumnWidths(table: HTMLTableElement): number[] {
	const firstRow = table.querySelector("tr");
	if (!firstRow) return [];
	return Array.from(firstRow.children).map((c) => (c as HTMLElement).getBoundingClientRect().width);
}

/** If `(clientX, target)` sits within the resize zone of a cell's right edge,
 *  return that cell, its table, and column index. */
function boundaryHit(
	clientX: number,
	clientY: number,
): { cell: HTMLElement; table: HTMLTableElement; columnIndex: number } | null {
	const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
	const cell = el?.closest?.("td,th") as HTMLElement | null;
	const table = cell?.closest?.("table") as HTMLTableElement | null;
	if (!cell || !table) return null;
	if (Math.abs(clientX - cell.getBoundingClientRect().right) > RESIZE_ZONE) return null;
	const columnIndex = Array.from(cell.parentElement?.children ?? []).indexOf(cell);
	return { cell, table, columnIndex };
}

export function TableColumnResizePlugin() {
	const [editor] = useLexicalComposerContext();
	const [handle, setHandle] = useState<HandleState | null>(null);

	useEffect(() => {
		// All listeners — including the per-drag mousemove/mouseup added in
		// onDown — share this signal, so a mid-drag unmount (note switch,
		// blank-recovery remount) tears every one down. Without it the drag
		// listeners would outlive the editor and a stray mouseup could fire
		// setTableColumnWidth against a disposed editor.
		const ac = new AbortController();
		const { signal } = ac;
		let dragging = false;

		const setCursorActive = (on: boolean) => {
			document.body.classList.toggle(CURSOR_CLASS, on);
		};

		const onMove = (event: MouseEvent) => {
			if (dragging) return;
			const hit = boundaryHit(event.clientX, event.clientY);
			if (!hit) {
				setHandle(null);
				setCursorActive(false);
				return;
			}
			const rect = hit.cell.getBoundingClientRect();
			const tableRect = hit.table.getBoundingClientRect();
			setHandle({ x: rect.right, top: tableRect.top, height: tableRect.height, dragging: false });
			setCursorActive(true);
		};

		// The handle is positioned in viewport space (`position: fixed`) but only
		// recomputed on mousemove — a pure scroll/resize would strand it at a
		// stale screen position, detached from the column edge. While hovering,
		// drop it (the next mousemove re-tracks); a live drag keeps itself
		// aligned via `onDrag`'s table-rect recompute.
		const onScrollOrResize = () => {
			if (!dragging) {
				setHandle(null);
				setCursorActive(false);
			}
		};

		const onDown = (event: MouseEvent) => {
			const hit = boundaryHit(event.clientX, event.clientY);
			if (!hit) return;
			event.preventDefault();
			event.stopPropagation();

			const widths = measureColumnWidths(hit.table);
			const startWidth = widths[hit.columnIndex] ?? MIN_TABLE_COLUMN_WIDTH;
			let tableKey = "";
			// `editor.read` (not `getEditorState().read`) so `$getNearestNodeFromDOMNode`
			// has an active editor — it reads the editor's DOM→node map, which the
			// bare editor-state read does not expose (Lexical error #196 otherwise).
			editor.read(() => {
				const cellNode = $getNearestNodeFromDOMNode(hit.cell);
				if (!cellNode) return;
				const table = $isTableNode(cellNode) ? cellNode : $findMatchingParent(cellNode, $isTableNode);
				if (table && $isTableNode(table)) tableKey = table.getKey();
			});
			if (!tableKey) return;

			const columnIndex = hit.columnIndex;
			const startX = event.clientX;
			const minX = startX - (startWidth - MIN_TABLE_COLUMN_WIDTH);
			dragging = true;
			setCursorActive(true);

			const onDrag = (ev: MouseEvent) => {
				const x = Math.max(minX, ev.clientX);
				const tableRect = hit.table.getBoundingClientRect();
				setHandle({ x, top: tableRect.top, height: tableRect.height, dragging: true });
			};
			const onUp = (ev: MouseEvent) => {
				dragging = false;
				document.removeEventListener("mousemove", onDrag);
				document.removeEventListener("mouseup", onUp);
				const next = Math.max(MIN_TABLE_COLUMN_WIDTH, startWidth + (ev.clientX - startX));
				setTableColumnWidth(editor, tableKey, columnIndex, next, widths);
				setHandle(null);
				setCursorActive(false);
			};
			document.addEventListener("mousemove", onDrag, { signal });
			document.addEventListener("mouseup", onUp, { signal });
		};

		document.addEventListener("mousemove", onMove, { signal });
		document.addEventListener("mousedown", onDown, { capture: true, signal });
		// Capture phase so a scroll in ANY ancestor scroll container (the editor's
		// own scroll pane, not just the window) drops the stale handle.
		document.addEventListener("scroll", onScrollOrResize, { capture: true, signal });
		window.addEventListener("resize", onScrollOrResize, { signal });
		return () => {
			ac.abort();
			setCursorActive(false);
		};
	}, [editor]);

	if (!handle) return null;
	return (
		<div
			className={HANDLE_CLASS}
			data-dragging={handle.dragging ? "true" : undefined}
			style={{ left: `${handle.x}px`, top: `${handle.top}px`, height: `${handle.height}px` }}
			aria-hidden="true"
		/>
	);
}
