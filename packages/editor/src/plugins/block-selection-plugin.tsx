/**
 * BlockSelectionPlugin — Brainstorm's block-level selection layer.
 *
 * Surface (`docs/apps/notes/30-selection.md`):
 *   - Vanilla store per editor (kept in a ref, exposed via context).
 *   - `useBlockSelection()` hook for consumers (gutter, action menu).
 *   - Mouse (B3b): `Cmd/Ctrl+click` toggles, `Shift+click` extends
 *     range (DOM order), plain click clears.
 *   - Keyboard (B3d): `Esc` clears; `Cmd+A` cycles caret-block → all;
 *     `ArrowUp/Down` walks; `Shift+ArrowUp/Down` extends range from
 *     anchor; `Cmd+ArrowUp/Down` jumps to first/last block;
 *     `Backspace/Delete` removes selected blocks (caret lands at the
 *     prev sibling's end). All chords route through the local
 *     `useShortcut` registry — no raw `e.key` per CLAUDE.md.
 *   - DOM class toggle + `aria-selected="true"` direct on the block
 *     element to avoid re-rendering 50 siblings on a marquee drag.
 *
 * Follow-ups: marquee drag (B3c), block move + duplicate (B3d2),
 * clipboard (B3e), a11y live region (B3f).
 */

import { $isListNode } from "@lexical/list";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
	$createParagraphNode,
	$getNearestNodeFromDOMNode,
	$getNodeByKey,
	$getRoot,
	$getSelection,
	$isElementNode,
	$isRangeSelection,
	type LexicalNode,
	type NodeKey,
} from "lexical";
import {
	type ReactNode,
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { useEditorT } from "../i18n";
import { getAllBlocks, topLevelKeyOf } from "../top-level-block";
import {
	BRAINSTORM_MIME,
	extractBrainstormPayloadFromHtml,
	insertBlocks,
	parseBrainstormPayload,
	plainTextToSerializedBlocks,
	serializeBlocksAsHtml,
	serializeBlocksAsJson,
	serializeBlocksAsText,
} from "./block-clipboard";
import { duplicateBlocks, indentBlocks, moveBlocksDown, moveBlocksUp } from "./block-ops";
import { type BlockSelectionSnapshot, BlockSelectionStore } from "./block-selection-store";
import { useEditorShortcut } from "./editor-shortcut";

/** Default chord bindings for block-selection. Apps that need to remap
 *  pass `chordOverrides` to `<BlockSelectionPlugin>`. */
export type BlockSelectionAction =
	| "cancel"
	| "selectAll"
	| "walkUp"
	| "walkDown"
	| "extendUp"
	| "extendDown"
	| "jumpFirst"
	| "jumpLast"
	| "delete"
	| "moveUp"
	| "moveDown"
	| "duplicate"
	| "indent"
	| "outdent"
	| "copy"
	| "cut"
	| "paste";

export type BlockSelectionChords = Record<BlockSelectionAction, readonly string[]>;

export const BLOCK_SELECTION_DEFAULT_CHORDS: BlockSelectionChords = Object.freeze({
	cancel: ["Escape"],
	selectAll: ["Mod+a"],
	walkUp: ["ArrowUp"],
	walkDown: ["ArrowDown"],
	extendUp: ["Shift+ArrowUp"],
	extendDown: ["Shift+ArrowDown"],
	jumpFirst: ["Mod+ArrowUp"],
	jumpLast: ["Mod+ArrowDown"],
	delete: ["Backspace", "Delete"],
	moveUp: ["Mod+Shift+ArrowUp"],
	moveDown: ["Mod+Shift+ArrowDown"],
	duplicate: ["Mod+d"],
	indent: ["Tab"],
	outdent: ["Shift+Tab"],
	copy: ["Mod+c"],
	cut: ["Mod+x"],
	paste: ["Mod+v"],
});

enum WalkDirection {
	Up = -1,
	Down = 1,
}

const SELECTED_CLASS = "bs-editor__block--selected";

/** Click targets that should NOT clear the block-selection: they are
 *  selection-aware surfaces rendered outside the contenteditable. Apps
 *  with extra selection-aware chrome extend this set via the plugin's
 *  `selectionPreservingSelector` prop. */
const BUILTIN_SELECTION_PRESERVING_SELECTOR =
	".bs-editor__block-gutter, .fm-menu, .bs-editor__drop-indicator";

const BlockSelectionContext = createContext<BlockSelectionStore | null>(null);

export function useBlockSelectionStore(): BlockSelectionStore {
	const store = useContext(BlockSelectionContext);
	if (!store) {
		throw new Error("useBlockSelection used outside <BlockSelectionPlugin>");
	}
	return store;
}

export function useBlockSelection(): BlockSelectionSnapshot {
	const store = useBlockSelectionStore();
	return useSyncExternalStore(
		(fn) => store.subscribe(fn),
		() => store.getSnapshot(),
	);
}

export type BlockSelectionPluginProps = {
	children: ReactNode;
	/** Extra CSS selector matching app-specific surfaces (slash menu,
	 *  media inspector, etc.) whose clicks must NOT clear the block
	 *  selection. Joined with the builtin gutter/action-menu selectors. */
	selectionPreservingSelector?: string;
	/** Chord overrides for the block-selection key bindings. Defaults
	 *  to `BLOCK_SELECTION_DEFAULT_CHORDS`; apps pass a `Partial<…>` to
	 *  remap individual actions. */
	chordOverrides?: Partial<BlockSelectionChords>;
};

export function BlockSelectionPlugin({
	children,
	selectionPreservingSelector,
	chordOverrides,
}: BlockSelectionPluginProps) {
	const [editor] = useLexicalComposerContext();
	const storeRef = useRef<BlockSelectionStore | null>(null);
	if (storeRef.current === null) {
		storeRef.current = new BlockSelectionStore();
	}
	const store = storeRef.current;

	const preservingSelector = selectionPreservingSelector
		? `${BUILTIN_SELECTION_PRESERVING_SELECTOR}, ${selectionPreservingSelector}`
		: BUILTIN_SELECTION_PRESERVING_SELECTOR;
	const chords: BlockSelectionChords = chordOverrides
		? { ...BLOCK_SELECTION_DEFAULT_CHORDS, ...chordOverrides }
		: BLOCK_SELECTION_DEFAULT_CHORDS;

	useDomClassEffect(editor, store);
	useMouseHandlers(editor, store, preservingSelector);
	useEscShortcut(editor, store, chords.cancel);
	useKeyboardNav(editor, store, chords);

	return (
		<BlockSelectionContext.Provider value={store}>
			{children}
			<BlockSelectionLiveRegion />
		</BlockSelectionContext.Provider>
	);
}

const SR_DEBOUNCE_MS = 150;

function pluralBlocksSelectedKey(
	count: number,
): "editor.a11y.blocksSelected.one" | "editor.a11y.blocksSelected.other" {
	return count === 1 ? "editor.a11y.blocksSelected.one" : "editor.a11y.blocksSelected.other";
}

function BlockSelectionLiveRegion() {
	const t = useEditorT();
	const { selectedKeys } = useBlockSelection();
	const count = selectedKeys.size;
	const [message, setMessage] = useState("");
	useEffect(() => {
		const handle = setTimeout(() => {
			setMessage(count === 0 ? "" : t(pluralBlocksSelectedKey(count), { count }));
		}, SR_DEBOUNCE_MS);
		return () => clearTimeout(handle);
	}, [count, t]);
	return (
		<div className="bs-editor__sr-only" role="status" aria-live="polite" aria-atomic="true">
			{message}
		</div>
	);
}

type LexicalEditorLike = ReturnType<typeof useLexicalComposerContext>[0];

function useDomClassEffect(editor: LexicalEditorLike, store: BlockSelectionStore): void {
	useEffect(() => {
		let previous = new Set<NodeKey>();
		const apply = () => {
			const { selectedKeys } = store.getSnapshot();
			for (const key of previous) {
				if (selectedKeys.has(key)) continue;
				const el = editor.getElementByKey(key);
				if (!el) continue;
				el.classList.remove(SELECTED_CLASS);
				el.removeAttribute("aria-selected");
			}
			for (const key of selectedKeys) {
				if (previous.has(key)) continue;
				const el = editor.getElementByKey(key);
				if (!el) continue;
				el.classList.add(SELECTED_CLASS);
				el.setAttribute("aria-selected", "true");
			}
			previous = new Set(selectedKeys);
		};
		const unsubscribe = store.subscribe(apply);
		apply();
		return () => {
			unsubscribe();
			for (const key of previous) {
				const el = editor.getElementByKey(key);
				if (!el) continue;
				el.classList.remove(SELECTED_CLASS);
				el.removeAttribute("aria-selected");
			}
		};
	}, [editor, store]);
}

function useMouseHandlers(
	editor: LexicalEditorLike,
	store: BlockSelectionStore,
	preservingSelector: string,
): void {
	useEffect(() => {
		function findTopLevelKey(target: Node): NodeKey | null {
			let key: NodeKey | null = null;
			// `$getNearestNodeFromDOMNode` needs an active *editor* (not just an
			// active editorState) to resolve the DOM→key map, so route through
			// `editor.read(...)` rather than `editor.getEditorState().read(...)`.
			editor.read(() => {
				const node = $getNearestNodeFromDOMNode(target);
				if (!node) return;
				// Walk to the root child — works for element *and* decorator
				// blocks (math/image/embed). Returns null only when the click
				// landed on the root itself (nothing to select).
				key = topLevelKeyOf(node);
			});
			return key;
		}

		function onMouseDown(event: MouseEvent) {
			const target = event.target;
			if (!(target instanceof Node)) return;
			const root = editor.getRootElement();
			// Selection chrome (gutter buttons, action menu items, slash menu)
			// is rendered outside the contenteditable root via portals. Clicks
			// on those surfaces must NOT clear the selection — they act on it.
			if (target instanceof Element && target.closest(preservingSelector)) {
				return;
			}
			if (!root || !root.contains(target)) {
				if (store.getSnapshot().selectedKeys.size > 0) store.clear();
				return;
			}

			const isMod = event.metaKey || event.ctrlKey;
			const isShift = event.shiftKey;

			if (!isMod && !isShift) {
				if (store.getSnapshot().selectedKeys.size > 0) store.clear();
				return;
			}

			const clickedKey = findTopLevelKey(target);
			if (!clickedKey) return;

			event.preventDefault();
			root.blur();

			if (isShift) {
				const ordered = orderedTopLevelKeysFromEditor(editor);
				const anchor = store.getSnapshot().anchorKey ?? clickedKey;
				const from = ordered.indexOf(anchor);
				const to = ordered.indexOf(clickedKey);
				if (from === -1 || to === -1) {
					store.setOnly(clickedKey);
					return;
				}
				const [lo, hi] = from <= to ? [from, to] : [to, from];
				store.setRange(ordered.slice(lo, hi + 1), anchor, clickedKey);
				return;
			}

			store.toggle(clickedKey);
		}

		document.addEventListener("mousedown", onMouseDown, true);
		return () => document.removeEventListener("mousedown", onMouseDown, true);
	}, [editor, store, preservingSelector]);
}

function useEscShortcut(
	editor: LexicalEditorLike,
	store: BlockSelectionStore,
	chords: readonly string[],
): void {
	const onEsc = useCallback(
		(event: KeyboardEvent) => {
			if (store.getSnapshot().selectedKeys.size === 0) return;
			event.preventDefault();
			store.clear();
			editor.focus();
		},
		[editor, store],
	);
	useEditorShortcut(chords, onEsc);
}

function useKeyboardNav(
	editor: LexicalEditorLike,
	store: BlockSelectionStore,
	chords: BlockSelectionChords,
): void {
	const isInEditor = useCallback((): boolean => {
		const root = editor.getRootElement();
		if (!root) return false;
		const active = document.activeElement;
		if (!active) return false;
		return root === active || root.contains(active);
	}, [editor]);

	const onSelectAll = useCallback(
		(event: KeyboardEvent) => {
			const snap = store.getSnapshot();
			const hasSelection = snap.selectedKeys.size > 0;
			if (!hasSelection && !isInEditor()) return;
			event.preventDefault();
			const ordered = orderedTopLevelKeysFromEditor(editor);
			if (ordered.length === 0) return;
			if (!hasSelection) {
				const containing = readContainingBlockKey(editor);
				if (containing) store.setOnly(containing);
				return;
			}
			if (snap.selectedKeys.size === ordered.length) return;
			const first = ordered[0];
			const last = ordered[ordered.length - 1];
			if (!first || !last) return;
			store.setRange(ordered, first, last);
		},
		[editor, store, isInEditor],
	);

	const walk = useCallback(
		(direction: WalkDirection, event: KeyboardEvent) => {
			const snap = store.getSnapshot();
			if (snap.selectedKeys.size === 0) return;
			event.preventDefault();
			const ordered = orderedTopLevelKeysFromEditor(editor);
			const ref = snap.focusKey ?? snap.anchorKey;
			if (!ref) return;
			const idx = ordered.indexOf(ref);
			if (idx < 0) return;
			const nextIdx = clampIndex(idx + direction, ordered.length);
			if (nextIdx === idx) return;
			const next = ordered[nextIdx];
			if (!next) return;
			store.setOnly(next);
		},
		[editor, store],
	);

	const extend = useCallback(
		(direction: WalkDirection, event: KeyboardEvent) => {
			const snap = store.getSnapshot();
			if (snap.selectedKeys.size === 0 || !snap.anchorKey) return;
			event.preventDefault();
			const ordered = orderedTopLevelKeysFromEditor(editor);
			const anchorIdx = ordered.indexOf(snap.anchorKey);
			if (anchorIdx < 0) return;
			const currentFocus = snap.focusKey ?? snap.anchorKey;
			const focusIdx = ordered.indexOf(currentFocus);
			if (focusIdx < 0) return;
			const nextFocusIdx = clampIndex(focusIdx + direction, ordered.length);
			if (nextFocusIdx === focusIdx) return;
			const nextFocus = ordered[nextFocusIdx];
			if (!nextFocus) return;
			const [lo, hi] =
				anchorIdx <= nextFocusIdx ? [anchorIdx, nextFocusIdx] : [nextFocusIdx, anchorIdx];
			store.setRange(ordered.slice(lo, hi + 1), snap.anchorKey, nextFocus);
		},
		[editor, store],
	);

	const jump = useCallback(
		(end: WalkDirection, event: KeyboardEvent) => {
			if (store.getSnapshot().selectedKeys.size === 0) return;
			event.preventDefault();
			const ordered = orderedTopLevelKeysFromEditor(editor);
			if (ordered.length === 0) return;
			const key = end === WalkDirection.Up ? ordered[0] : ordered[ordered.length - 1];
			if (!key) return;
			store.setOnly(key);
		},
		[editor, store],
	);

	const deleteBlocks = useCallback(
		(event: KeyboardEvent) => {
			const snap = store.getSnapshot();
			if (snap.selectedKeys.size === 0) return;
			event.preventDefault();
			const keys = snap.selectedKeys;
			editor.update(() => {
				removeBlocksAndPlaceCaret(keys);
			});
			store.clear();
		},
		[editor, store],
	);

	const onWalkUp = useCallback((e: KeyboardEvent) => walk(WalkDirection.Up, e), [walk]);
	const onWalkDown = useCallback((e: KeyboardEvent) => walk(WalkDirection.Down, e), [walk]);
	const onExtendUp = useCallback((e: KeyboardEvent) => extend(WalkDirection.Up, e), [extend]);
	const onExtendDown = useCallback((e: KeyboardEvent) => extend(WalkDirection.Down, e), [extend]);
	const onJumpFirst = useCallback((e: KeyboardEvent) => jump(WalkDirection.Up, e), [jump]);
	const onJumpLast = useCallback((e: KeyboardEvent) => jump(WalkDirection.Down, e), [jump]);

	const onMoveUp = useCallback(
		(event: KeyboardEvent) => {
			const snap = store.getSnapshot();
			if (snap.selectedKeys.size === 0) return;
			event.preventDefault();
			moveBlocksUp(editor, snap.selectedKeys);
		},
		[editor, store],
	);

	const onMoveDown = useCallback(
		(event: KeyboardEvent) => {
			const snap = store.getSnapshot();
			if (snap.selectedKeys.size === 0) return;
			event.preventDefault();
			moveBlocksDown(editor, snap.selectedKeys);
		},
		[editor, store],
	);

	const onDuplicate = useCallback(
		(event: KeyboardEvent) => {
			const snap = store.getSnapshot();
			if (snap.selectedKeys.size === 0) return;
			event.preventDefault();
			duplicateBlocks(editor, snap.selectedKeys);
		},
		[editor, store],
	);

	const onIndent = useCallback(
		(event: KeyboardEvent) => {
			const snap = store.getSnapshot();
			if (snap.selectedKeys.size === 0) return;
			event.preventDefault();
			indentBlocks(editor, snap.selectedKeys, false);
		},
		[editor, store],
	);

	const onOutdent = useCallback(
		(event: KeyboardEvent) => {
			const snap = store.getSnapshot();
			if (snap.selectedKeys.size === 0) return;
			event.preventDefault();
			indentBlocks(editor, snap.selectedKeys, true);
		},
		[editor, store],
	);

	const onCopy = useCallback(
		(event: KeyboardEvent) => {
			const snap = store.getSnapshot();
			if (snap.selectedKeys.size === 0) return;
			event.preventDefault();
			void writeBlocksToClipboard(editor, snap.selectedKeys);
		},
		[editor, store],
	);

	const onCut = useCallback(
		(event: KeyboardEvent) => {
			const snap = store.getSnapshot();
			if (snap.selectedKeys.size === 0) return;
			event.preventDefault();
			void writeBlocksToClipboard(editor, snap.selectedKeys).then(() => {
				editor.update(
					() => {
						removeBlocksAndPlaceCaret(snap.selectedKeys);
					},
					{ discrete: true },
				);
				store.clear();
			});
		},
		[editor, store],
	);

	const onPaste = useCallback(
		(event: KeyboardEvent) => {
			const snap = store.getSnapshot();
			if (snap.selectedKeys.size === 0) return;
			event.preventDefault();
			void readClipboardAndPaste(editor, snap.selectedKeys).then((inserted) => {
				if (inserted.length === 0) return;
				store.setRange(inserted, inserted[0] as NodeKey, inserted[inserted.length - 1] as NodeKey);
			});
		},
		[editor, store],
	);

	useEditorShortcut(chords.selectAll, onSelectAll);
	useEditorShortcut(chords.walkUp, onWalkUp);
	useEditorShortcut(chords.walkDown, onWalkDown);
	useEditorShortcut(chords.extendUp, onExtendUp);
	useEditorShortcut(chords.extendDown, onExtendDown);
	useEditorShortcut(chords.jumpFirst, onJumpFirst);
	useEditorShortcut(chords.jumpLast, onJumpLast);
	useEditorShortcut(chords.delete, deleteBlocks);
	useEditorShortcut(chords.moveUp, onMoveUp);
	useEditorShortcut(chords.moveDown, onMoveDown);
	useEditorShortcut(chords.duplicate, onDuplicate);
	useEditorShortcut(chords.indent, onIndent);
	useEditorShortcut(chords.outdent, onOutdent);
	useEditorShortcut(chords.copy, onCopy);
	useEditorShortcut(chords.cut, onCut);
	useEditorShortcut(chords.paste, onPaste);
}

/**
 * Block-aware delete: removes every node whose key is in `keys` (list
 * items included), drops any list that became empty, and places the
 * caret on the predecessor block (or a fresh paragraph if the doc is
 * now empty). Must run inside an `editor.update` callback.
 */
function removeBlocksAndPlaceCaret(keys: ReadonlySet<NodeKey>): void {
	const ordered = listItemAwareBlockOrder();
	const firstIdx = ordered.findIndex((b) => keys.has(b.getKey()));
	const predecessor: LexicalNode | null = firstIdx > 0 ? (ordered[firstIdx - 1] ?? null) : null;
	for (const key of keys) {
		const node = $getNodeByKey(key);
		if (node) node.remove();
	}
	// Collapse lists that lost all their items.
	for (const child of $getRoot().getChildren()) {
		if ($isListNode(child) && child.getChildrenSize() === 0) child.remove();
	}
	const root = $getRoot();
	if (root.getChildrenSize() === 0) {
		const paragraph = $createParagraphNode();
		root.append(paragraph);
		paragraph.selectStart();
		return;
	}
	if (predecessor?.isAttached() && $isElementNode(predecessor)) {
		predecessor.selectEnd();
		return;
	}
	const remaining = listItemAwareBlockOrder();
	const first = remaining[0];
	if (first && $isElementNode(first)) first.selectStart();
}

function listItemAwareBlockOrder(): LexicalNode[] {
	return getAllBlocks($getRoot());
}

async function writeBlocksToClipboard(
	editor: LexicalEditorLike,
	keys: ReadonlySet<NodeKey>,
): Promise<void> {
	const json = serializeBlocksAsJson(editor, keys);
	const text = serializeBlocksAsText(editor, keys);
	const html = serializeBlocksAsHtml(editor, keys);
	const items: Record<string, Blob> = {
		"text/plain": new Blob([text], { type: "text/plain" }),
		"text/html": new Blob([html], { type: "text/html" }),
	};
	try {
		items[BRAINSTORM_MIME] = new Blob([json], { type: BRAINSTORM_MIME });
	} catch {
		// Some browsers reject custom MIME blobs; fall through with html/text only.
	}
	try {
		await navigator.clipboard.write([new ClipboardItem(items)]);
		return;
	} catch (error) {
		console.warn("[notes/clipboard] rich copy failed, falling back to text:", error);
	}
	try {
		await navigator.clipboard.writeText(text);
	} catch (error) {
		console.error("[notes/clipboard] copy failed:", error);
	}
}

async function readClipboardAndPaste(
	editor: LexicalEditorLike,
	replaceKeys: ReadonlySet<NodeKey>,
): Promise<readonly NodeKey[]> {
	try {
		const items = await navigator.clipboard.read();
		for (const item of items) {
			if (item.types.includes(BRAINSTORM_MIME)) {
				const blob = await item.getType(BRAINSTORM_MIME);
				const payload = parseBrainstormPayload(await blob.text());
				if (payload) return insertBlocks(editor, payload.blocks, replaceKeys);
			}
			if (item.types.includes("text/html")) {
				const blob = await item.getType("text/html");
				const payload = extractBrainstormPayloadFromHtml(await blob.text());
				if (payload) return insertBlocks(editor, payload.blocks, replaceKeys);
			}
			if (item.types.includes("text/plain")) {
				const blob = await item.getType("text/plain");
				const text = await blob.text();
				const blocks = plainTextToSerializedBlocks(text);
				if (blocks.length > 0) return insertBlocks(editor, blocks, replaceKeys);
			}
		}
	} catch (error) {
		// `navigator.clipboard.read()` requires user activation. If denied,
		// fall back to writeText reading via `readText`.
		try {
			const text = await navigator.clipboard.readText();
			const blocks = plainTextToSerializedBlocks(text);
			if (blocks.length > 0) return insertBlocks(editor, blocks, replaceKeys);
		} catch (inner) {
			console.error("[notes/clipboard] paste failed:", inner, error);
		}
	}
	return [];
}

function orderedTopLevelKeysFromEditor(editor: LexicalEditorLike): NodeKey[] {
	const keys: NodeKey[] = [];
	editor.getEditorState().read(() => {
		for (const block of getAllBlocks($getRoot())) {
			keys.push(block.getKey());
		}
	});
	return keys;
}

function readContainingBlockKey(editor: LexicalEditorLike): NodeKey | null {
	let key: NodeKey | null = null;
	editor.getEditorState().read(() => {
		const sel = $getSelection();
		if (!$isRangeSelection(sel)) return;
		key = topLevelKeyOf(sel.anchor.getNode());
	});
	return key;
}

function clampIndex(idx: number, length: number): number {
	if (idx < 0) return 0;
	if (idx >= length) return length - 1;
	return idx;
}
