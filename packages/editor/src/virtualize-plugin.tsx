/**
 * `<VirtualizePlugin>` — Phase 1 of editor virtualization
 * (docs/editing/52 §Phase 1, OQ-185 keystones, unconditional).
 *
 * Single `registerUpdateListener` per editor. On every committed update
 * that touched root's children, walks `getAllBlocks(root)` and for each
 * top-level block element:
 *   1. Stamps the StylePack-contract hook attr `data-bs-block` (one
 *      contract shared with OQ-183).
 *   2. Adds the `bs-editor__block` class (which carries
 *      `content-visibility: auto` + `contain-intrinsic-size`).
 *   3. Sets `--bs-block-intrinsic-h` from the height cache (live
 *      measurement) or the typed estimate, so the browser's
 *      skip-rendering of offscreen blocks reserves the right space and
 *      the scrollbar geometry stays stable.
 *   4. Registers the element with the shared `ResizeObserver` in the
 *      height cache, so the first on-screen render replaces the
 *      estimate with a real measurement.
 *
 * One `registerUpdateListener` is cheaper and more uniform than a fan
 * of per-Klass mutation listeners (the alternative): the listener fires
 * once per commit regardless of how many node classes the doc holds,
 * and a no-op early-out (`dirtyElements.size === 0 && !dirtyLeaves.size`)
 * keeps idle commits free.
 *
 * Phase 2 (true reconciliation-windowing) will hang off the same
 * `data-bs-block` hooks and the same height cache.
 */

import { $isCodeNode } from "@lexical/code";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $isHeadingNode } from "@lexical/rich-text";
import {
	$getRoot,
	$isDecoratorNode,
	$isElementNode,
	$isTextNode,
	type LexicalEditor,
	type LexicalNode,
	type NodeKey,
} from "lexical";
import { useEffect } from "react";
import { BLOCK_ID_ATTR, stableBlockId } from "./block-id";
import { BlockKind, type HeightCache, createHeightCache } from "./height-cache";
import { getAllBlocks } from "./top-level-block";

const BLOCK_CLASS = "bs-editor__block";

export type VirtualizePluginProps = {
	/** Inject a shared height cache (e.g. for tests that want to assert on it,
	 *  or for a Phase-2 windowing plugin that wants to read prefix-sums).
	 *  Defaults to a fresh per-editor cache. */
	heightCache?: HeightCache;
};

export function VirtualizePlugin(props: VirtualizePluginProps = {}): null {
	const [editor] = useLexicalComposerContext();
	useEffect(() => {
		return mountVirtualization(editor, props.heightCache);
	}, [editor, props.heightCache]);
	return null;
}

/** The plugin's lifecycle as a plain function so non-React callers
 *  (and tests) can drive it without mounting React. */
export function mountVirtualization(editor: LexicalEditor, injected?: HeightCache): () => void {
	const cache = injected ?? createHeightCache();
	const observerDisposers = new Map<NodeKey, () => void>();

	const stamp = (): void => {
		editor.getEditorState().read(() => {
			const root = $getRoot();
			const blocks = getAllBlocks(root);
			const seen = new Set<NodeKey>();
			for (const block of blocks) {
				const key = block.getKey();
				seen.add(key);
				const el = editor.getElementByKey(key);
				if (!el) continue;
				stampElement(el, block, key, cache, observerDisposers);
			}
			for (const [key, dispose] of observerDisposers) {
				if (!seen.has(key)) {
					dispose();
					observerDisposers.delete(key);
				}
			}
		});
	};

	const unregister = editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
		if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
		stamp();
	});

	stamp();

	return () => {
		unregister();
		for (const dispose of observerDisposers.values()) dispose();
		observerDisposers.clear();
		if (!injected) cache.dispose();
	};
}

function stampElement(
	el: HTMLElement,
	node: LexicalNode,
	key: NodeKey,
	cache: HeightCache,
	observerDisposers: Map<NodeKey, () => void>,
): void {
	const id = stableBlockId(node);
	if (el.getAttribute(BLOCK_ID_ATTR) !== id) el.setAttribute(BLOCK_ID_ATTR, id);
	if (!el.classList.contains(BLOCK_CLASS)) el.classList.add(BLOCK_CLASS);

	const measured = cache.get(id);
	const reserved = measured ?? cache.estimate(blockKindOf(node), blockHintOf(node));
	const reservedPx = `${Math.max(1, Math.round(reserved))}px`;
	if (el.style.getPropertyValue("--bs-block-intrinsic-h") !== reservedPx) {
		el.style.setProperty("--bs-block-intrinsic-h", reservedPx);
	}

	if (!observerDisposers.has(key)) {
		observerDisposers.set(key, cache.observe(id, el));
	}
}

function blockKindOf(node: LexicalNode): BlockKind {
	if ($isHeadingNode(node)) {
		const tag = node.getTag();
		if (tag === "h1") return BlockKind.HeadingH1;
		if (tag === "h2") return BlockKind.HeadingH2;
		return BlockKind.HeadingH3;
	}
	if ($isCodeNode(node)) return BlockKind.Code;
	if ($isDecoratorNode(node)) return BlockKind.Embed;
	return BlockKind.Paragraph;
}

function blockHintOf(node: LexicalNode): number | undefined {
	if ($isCodeNode(node)) {
		return countLines(textOf(node));
	}
	if ($isElementNode(node)) {
		return textOf(node).length;
	}
	return undefined;
}

function textOf(node: LexicalNode): string {
	if ($isTextNode(node)) return node.getTextContent();
	if (!$isElementNode(node)) return "";
	let acc = "";
	for (const child of node.getChildren()) acc += textOf(child);
	return acc;
}

function countLines(s: string): number {
	if (s.length === 0) return 1;
	let lines = 1;
	for (let i = 0; i < s.length; i++) {
		if (s.charCodeAt(i) === 10) lines++;
	}
	return lines;
}
