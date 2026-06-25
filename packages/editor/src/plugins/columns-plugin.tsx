/**
 * ColumnsPlugin — INSERT_COLUMNS_COMMAND plus the drag-resizer.
 *
 * Insertion wraps the current block into column 1 of a fresh N-column
 * layout (the rest start with an empty paragraph). The resizer reuses
 * the same root-listener + edge hit-test pattern as the toggle
 * disclosure / table toolbar: a pointerdown within the right-edge gutter
 * of a column starts a drag that trades flex-grow between that column
 * and the next, sized against the row's pixel width.
 */

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import {
	$createParagraphNode,
	$getNearestNodeFromDOMNode,
	$getNodeByKey,
	$getSelection,
	$isElementNode,
	$isRangeSelection,
	COMMAND_PRIORITY_EDITOR,
	createCommand,
} from "lexical";
import { useEffect } from "react";
import {
	$createColumnNode,
	$createColumnsNode,
	$isColumnNode,
	type ColumnNode,
} from "../nodes/columns-node";

/** Number of columns to create. */
export const INSERT_COLUMNS_COMMAND = createCommand<number>("INSERT_COLUMNS_COMMAND");

/** Half-width of the grab zone around a column boundary's midpoint. A pointer
 *  within this many px of the gap centre starts a resize drag (so the whole
 *  inter-column gap is grabbable, not just a pseudo-element sliver). */
const RESIZE_GUTTER_PX = 12;

export function ColumnsPlugin() {
	const [editor] = useLexicalComposerContext();

	useEffect(() => {
		function onPointerDown(event: PointerEvent) {
			if (event.button !== 0) return;
			const target = event.target;
			if (!(target instanceof HTMLElement)) return;
			// The resize grab zone is the *gap* between two adjacent columns —
			// scan the row and pick the boundary whose midpoint is nearest the
			// pointer. Hit-testing the gap directly (rather than a sliver pseudo
			// pinned to one column's edge) makes every divider grabbable,
			// including the middle one in a 3-column layout.
			const rowEl = target.closest<HTMLElement>(".notes__columns");
			if (!rowEl) return;
			const cols = Array.from(rowEl.children).filter(
				(c): c is HTMLElement => c instanceof HTMLElement && c.classList.contains("notes__column"),
			);
			let colEl: HTMLElement | null = null;
			let rect: DOMRect | null = null;
			for (let i = 0; i < cols.length - 1; i += 1) {
				const left = cols[i];
				const right = cols[i + 1];
				if (!left || !right) continue;
				const leftRect = left.getBoundingClientRect();
				const rightRect = right.getBoundingClientRect();
				const mid = (leftRect.right + rightRect.left) / 2;
				if (
					Math.abs(event.clientX - mid) <= RESIZE_GUTTER_PX &&
					event.clientY >= leftRect.top &&
					event.clientY <= leftRect.bottom
				) {
					colEl = left;
					rect = leftRect;
					break;
				}
			}
			if (!colEl || !rect) return;

			let leftKey = "";
			let rightKey = "";
			let startLeftFlex = 1;
			let startRightFlex = 1;
			// `$getNearestNodeFromDOMNode` needs an active *editor* — route
			// through `editor.read(...)` rather than `editorState.read(...)`.
			editor.read(() => {
				const node = $getNearestNodeFromDOMNode(colEl);
				let col: ColumnNode | null = null;
				for (let n = node; n; n = n.getParent()) {
					if ($isColumnNode(n)) {
						col = n;
						break;
					}
				}
				const next = col?.getNextSibling();
				if (!col || !$isColumnNode(next)) return;
				leftKey = col.getKey();
				rightKey = next.getKey();
				startLeftFlex = col.getFlex();
				startRightFlex = next.getFlex();
			});
			if (!leftKey || !rightKey) return;

			const rowWidth = colEl.parentElement?.getBoundingClientRect().width ?? rect.width * 2;
			const startX = event.clientX;
			const totalFlex = startLeftFlex + startRightFlex;
			event.preventDefault();

			function onMove(e: PointerEvent) {
				const deltaFrac = ((e.clientX - startX) / rowWidth) * totalFlex;
				const left = Math.max(0.25, startLeftFlex + deltaFrac);
				const right = Math.max(0.25, startRightFlex - deltaFrac);
				editor.update(() => {
					const l = $getNodeByKey(leftKey);
					const r = $getNodeByKey(rightKey);
					if ($isColumnNode(l)) l.setFlex(left);
					if ($isColumnNode(r)) r.setFlex(right);
				});
			}
			function onUp() {
				document.removeEventListener("pointermove", onMove, true);
				document.removeEventListener("pointerup", onUp, true);
				document.body.style.cursor = "";
			}
			document.body.style.cursor = "col-resize";
			document.addEventListener("pointermove", onMove, true);
			document.addEventListener("pointerup", onUp, true);
		}

		const root = editor.getRootElement();
		root?.addEventListener("pointerdown", onPointerDown);
		const unregisterRoot = editor.registerRootListener((next, prev) => {
			prev?.removeEventListener("pointerdown", onPointerDown);
			next?.addEventListener("pointerdown", onPointerDown);
		});

		return mergeRegister(
			() => root?.removeEventListener("pointerdown", onPointerDown),
			unregisterRoot,
			editor.registerCommand(
				INSERT_COLUMNS_COMMAND,
				(count) => {
					const n = Math.min(4, Math.max(2, Math.floor(count)));
					const selection = $getSelection();
					if (!$isRangeSelection(selection)) return false;
					let block = selection.anchor.getNode();
					try {
						block = block.getTopLevelElementOrThrow();
					} catch {
						return false;
					}
					const columns = $createColumnsNode();
					const first = $createColumnNode();
					const moved = $createParagraphNode();
					if ($isElementNode(block)) {
						for (const child of block.getChildren()) moved.append(child);
					}
					first.append(moved);
					columns.append(first);
					for (let i = 1; i < n; i += 1) {
						columns.append($createColumnNode().append($createParagraphNode()));
					}
					block.replace(columns);
					moved.selectEnd();
					return true;
				},
				COMMAND_PRIORITY_EDITOR,
			),
		);
	}, [editor]);

	return null;
}
