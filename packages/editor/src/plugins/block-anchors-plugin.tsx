/**
 * `BlockAnchorsPlugin` — the session lifecycle for durable block anchors
 * (B11.13). Pairs with the pure persistence/matching core in
 * `../block-anchors.ts`:
 *
 *   - **Mint** (`ensureAnchorId`): "Copy link to block" asks the
 *     controller for a durable id for a block's session key. An existing
 *     session binding (or a persisted entry that fingerprints identically)
 *     is reused; otherwise a fresh `mintBlockId()` entry is written to
 *     the store.
 *   - **Track**: a debounced update listener re-snapshots every
 *     session-bound anchor after edits, so the persisted fingerprint
 *     follows the block through typing / turn-into / moves. A deleted
 *     block just unbinds (the persisted entry stays — undo or a paste-
 *     back can re-resolve it by fingerprint).
 *   - **Resolve** (`resolveBlockKey`): an inbound `#block-<id>` looks up
 *     the session binding first, then the persisted fingerprint via
 *     `matchAnchorBlock`, then — for links minted before durable anchors
 *     existed — falls back to treating the id as a live NodeKey. A
 *     successful fingerprint resolution rebinds and self-heals the entry.
 *
 * The controller is reachable from non-React surfaces (the block-command
 * catalogue's `run(ctx)`) via `getBlockAnchorsController(editor)` — the
 * same module-registry pattern `editor-host` uses, because commands hold
 * an editor, not a React context.
 */

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getNodeByKey, $getRoot, type LexicalEditor, type NodeKey } from "lexical";
import { useEffect } from "react";
import {
	type BlockAnchorEntry,
	type BlockAnchorStore,
	type BlockSnapshot,
	anchorEntriesEqual,
	fingerprintText,
	matchAnchorBlock,
} from "../block-anchors";
import { mintBlockId } from "../block-id";
import { getAllBlocks, isTopLevelBlock } from "../top-level-block";

const REFRESH_DEBOUNCE_MS = 600;
/** An inbound reveal keeps retrying while the doc hydrates from Yjs;
 *  after this window it gives up (plain open, no scroll). */
const REVEAL_TIMEOUT_MS = 8_000;
const FLASH_DURATION_MS = 2_000;

export const BLOCK_ANCHOR_FLASH_CLASS = "bs-block-anchor-flash";

export type BlockAnchorsController = {
	/** Durable anchor id for the block at `blockKey`, minting + persisting
	 *  one when none is bound. `null` when the key isn't a live top-level
	 *  block. */
	ensureAnchorId(blockKey: NodeKey): string | null;
	/** Session key of the block `anchorId` points at, re-resolving through
	 *  the persisted fingerprint (and the legacy raw-NodeKey form) when no
	 *  session binding exists. `null` when the block is gone. */
	resolveBlockKey(anchorId: string): NodeKey | null;
	/** Flush the pending fingerprint refresh immediately (test seam — the
	 *  update listener debounces writes off the keystroke path). */
	refreshNow(): void;
};

const controllers = new WeakMap<LexicalEditor, BlockAnchorsController>();

export function getBlockAnchorsController(editor: LexicalEditor): BlockAnchorsController | null {
	return controllers.get(editor) ?? null;
}

function collectBlockSnapshots(editor: LexicalEditor): BlockSnapshot[] {
	return editor.getEditorState().read(() => {
		const blocks = getAllBlocks($getRoot());
		return blocks.map((node, index) => ({
			key: node.getKey(),
			type: node.getType(),
			text: fingerprintText(node.getTextContent()),
			index,
		}));
	});
}

/** Plugin lifecycle as a plain function so headless tests (and non-React
 *  hosts) can drive it without mounting React. */
export function mountBlockAnchors(editor: LexicalEditor, store: BlockAnchorStore): () => void {
	const keyByAnchor = new Map<string, NodeKey>();
	const anchorByKey = new Map<NodeKey, string>();
	let refreshTimer: ReturnType<typeof setTimeout> | null = null;
	let disposed = false;

	const bind = (anchorId: string, key: NodeKey): void => {
		keyByAnchor.set(anchorId, key);
		anchorByKey.set(key, anchorId);
	};
	const unbind = (anchorId: string): void => {
		const key = keyByAnchor.get(anchorId);
		keyByAnchor.delete(anchorId);
		if (key !== undefined) anchorByKey.delete(key);
	};

	const refresh = (): void => {
		if (disposed || keyByAnchor.size === 0) return;
		const snapshots = collectBlockSnapshots(editor);
		const byKey = new Map(snapshots.map((s) => [s.key, s]));
		for (const [anchorId, key] of [...keyByAnchor]) {
			const snapshot = byKey.get(key);
			if (!snapshot) {
				// Block gone this session — keep the persisted entry (undo /
				// re-resolution may bring the content back), drop the binding.
				unbind(anchorId);
				continue;
			}
			const entry: BlockAnchorEntry = {
				type: snapshot.type,
				text: snapshot.text,
				index: snapshot.index,
			};
			const stored = store.get(anchorId);
			if (!stored || !anchorEntriesEqual(stored, entry)) store.set(anchorId, entry);
		}
	};

	const scheduleRefresh = (): void => {
		if (refreshTimer !== null) return;
		refreshTimer = setTimeout(() => {
			refreshTimer = null;
			refresh();
		}, REFRESH_DEBOUNCE_MS);
	};

	const controller: BlockAnchorsController = {
		ensureAnchorId(blockKey) {
			const bound = anchorByKey.get(blockKey);
			if (bound !== undefined) return bound;
			const snapshot = collectBlockSnapshots(editor).find((s) => s.key === blockKey);
			if (!snapshot) return null;
			const entry: BlockAnchorEntry = {
				type: snapshot.type,
				text: snapshot.text,
				index: snapshot.index,
			};
			const anchorId = store.findByEntry(entry) ?? mintBlockId();
			store.set(anchorId, entry);
			bind(anchorId, blockKey);
			return anchorId;
		},
		resolveBlockKey(anchorId) {
			const bound = keyByAnchor.get(anchorId);
			if (bound !== undefined) {
				const alive = editor.getEditorState().read(() => {
					const node = $getNodeByKey(bound);
					return node !== null && isTopLevelBlock(node);
				});
				if (alive) return bound;
				unbind(anchorId);
			}
			const entry = store.get(anchorId);
			if (entry) {
				const key = matchAnchorBlock(entry, collectBlockSnapshots(editor));
				if (!key) return null;
				bind(anchorId, key);
				// Self-heal: re-snapshot so the entry reflects the block as
				// found (its index may have drifted since the last session).
				refresh();
				return key;
			}
			// Legacy `#block-<NodeKey>` link (pre-durable-anchor mints): the
			// raw key still works within the minting session.
			const live = editor.getEditorState().read(() => {
				const node = $getNodeByKey(anchorId);
				return node !== null && isTopLevelBlock(node) ? node.getKey() : null;
			});
			return live;
		},
		refreshNow() {
			if (refreshTimer !== null) {
				clearTimeout(refreshTimer);
				refreshTimer = null;
			}
			refresh();
		},
	};

	controllers.set(editor, controller);
	const unregister = editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
		if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
		scheduleRefresh();
	});

	return () => {
		disposed = true;
		unregister();
		if (refreshTimer !== null) {
			clearTimeout(refreshTimer);
			refreshTimer = null;
		}
		if (controllers.get(editor) === controller) controllers.delete(editor);
	};
}

/** Scroll the block into view and flash it. Returns `false` when the
 *  block has no DOM yet (caller retries on the next commit). */
export function revealBlockByKey(editor: LexicalEditor, key: NodeKey): boolean {
	let el: HTMLElement | null = null;
	try {
		el = editor.getElementByKey(key);
	} catch {
		// Headless editors throw here — a DOM-less surface has nothing to
		// scroll, which is the same degrade as "no element yet".
		return false;
	}
	if (!el) return false;
	el.scrollIntoView({ block: "center", behavior: "smooth" });
	el.classList.remove(BLOCK_ANCHOR_FLASH_CLASS);
	// Force a reflow so re-adding restarts the CSS animation on repeat
	// reveals of the same block.
	void (el as HTMLElement).offsetWidth;
	el.classList.add(BLOCK_ANCHOR_FLASH_CLASS);
	setTimeout(() => el.classList.remove(BLOCK_ANCHOR_FLASH_CLASS), FLASH_DURATION_MS);
	return true;
}

/** An inbound `#block-<id>` open request. `nonce` lets the host re-fire
 *  the same anchor (a second click on the same link re-scrolls). */
export type BlockAnchorReveal = {
	anchorId: string;
	nonce: number;
};

/** Try to reveal `anchorId` now; while it doesn't resolve (the doc is
 *  still hydrating from Yjs) retry on every commit until success or
 *  timeout, then report through `onDone`. Returns a canceller. */
export function startAnchorReveal(
	editor: LexicalEditor,
	anchorId: string,
	onDone?: (revealed: boolean) => void,
): () => void {
	let done = false;
	let stopListener: (() => void) | null = null;
	let timeout: ReturnType<typeof setTimeout> | null = null;
	const finish = (revealed: boolean, report: boolean): void => {
		if (done) return;
		done = true;
		if (stopListener) stopListener();
		if (timeout !== null) clearTimeout(timeout);
		if (report) onDone?.(revealed);
	};
	const attempt = (): boolean => {
		const controller = getBlockAnchorsController(editor);
		if (!controller) return false;
		const key = controller.resolveBlockKey(anchorId);
		if (!key) return false;
		return revealBlockByKey(editor, key);
	};
	if (attempt()) {
		finish(true, true);
		return () => {};
	}
	stopListener = editor.registerUpdateListener(() => {
		if (attempt()) finish(true, true);
	});
	timeout = setTimeout(() => finish(false, true), REVEAL_TIMEOUT_MS);
	return () => finish(false, false);
}

export type BlockAnchorsPluginProps = {
	store: BlockAnchorStore;
	/** Pending inbound reveal; the plugin retries across commits while the
	 *  doc hydrates, then calls `onRevealDone` (success or timeout). */
	reveal?: BlockAnchorReveal | null;
	onRevealDone?: (revealed: boolean) => void;
};

export function BlockAnchorsPlugin({
	store,
	reveal = null,
	onRevealDone,
}: BlockAnchorsPluginProps): null {
	const [editor] = useLexicalComposerContext();

	useEffect(() => mountBlockAnchors(editor, store), [editor, store]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-run on the nonce (repeat clicks on one anchor), not on callback identity
	useEffect(() => {
		if (!reveal) return;
		return startAnchorReveal(editor, reveal.anchorId, onRevealDone);
	}, [editor, reveal?.anchorId, reveal?.nonce]);

	return null;
}
