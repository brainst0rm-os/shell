/**
 * CommentHighlightPlugin (B11.9) — marks the editor blocks that carry an open
 * comment thread so a reader sees where the discussion is. Shared across editor
 * apps; prop-driven (the comments context isn't lifted over every editor), so
 * the host computes the open-comment block ids (`openCommentBlockIds`) and the
 * plugin maps them to live block DOM via the session NodeKey.
 *
 * Imperative DOM decoration (a `data-bs-comment` attribute → CSS accent) rather
 * than a Lexical node mutation: the highlight is per-device chrome, never
 * touches the document model, and re-applies on every editor update (block DOM
 * rebuilds on edit) + whenever the id set changes. Durable cross-reload
 * anchoring waits on the NodeState upgrade (B11.13); session keys suffice for
 * the live highlight.
 *
 * Click-to-thread: when the host passes `onBlockClick`, hovering a commented
 * block reveals a floating comment chip at its top-right (the same
 * hover-revealed fixed-position chrome as the code-block toolbar — a distinct
 * affordance, so a plain click inside the block never hijacks to the panel);
 * clicking it hands the block id back so the host can scroll its comments
 * panel to the thread.
 */

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useEffect, useRef, useState } from "react";
import { useEditorT } from "../i18n";
import { CommentIcon } from "../icons";

export const COMMENT_BLOCK_ATTR = "data-bs-comment";

const CHIP_EDGE_GAP = 4;

export function CommentHighlightPlugin({
	blockIds,
	onBlockClick,
}: {
	blockIds: readonly string[];
	/** Click-to-thread (B11.9): fired with the commented block's (session)
	 *  block id when its hover chip is clicked. Omit to render highlight only. */
	onBlockClick?: (blockId: string) => void;
}) {
	const [editor] = useLexicalComposerContext();
	const t = useEditorT();
	const [target, setTarget] = useState<HTMLElement | null>(null);
	const [pos, setPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
	const chipRef = useRef<HTMLButtonElement | null>(null);

	useEffect(() => {
		const want = new Set(blockIds);
		const apply = (): void => {
			const root = editor.getRootElement();
			if (!root) return;
			for (const el of root.querySelectorAll(`[${COMMENT_BLOCK_ATTR}]`)) {
				el.removeAttribute(COMMENT_BLOCK_ATTR);
			}
			// The attribute carries the block's session key so the hover chip can
			// hand the id back without another editor read.
			for (const key of want) {
				editor.getElementByKey(key)?.setAttribute(COMMENT_BLOCK_ATTR, key);
			}
		};
		apply();
		// Re-apply after every editor update — block elements are recreated on
		// edit, dropping the attribute, so the highlight must be re-stamped.
		return editor.registerUpdateListener(apply);
	}, [editor, blockIds]);

	// Track which commented block the pointer is over (chip mode only). Staying
	// on the chip itself — outside the contenteditable — keeps it shown.
	useEffect(() => {
		if (!onBlockClick) return;
		const onMove = (event: MouseEvent): void => {
			const el = event.target as HTMLElement | null;
			if (!el) return;
			if (chipRef.current?.contains(el)) return;
			const block = (el.closest?.(`[${COMMENT_BLOCK_ATTR}]`) as HTMLElement | null) ?? null;
			setTarget((prev) => (prev === block ? prev : block));
		};
		document.addEventListener("mousemove", onMove);
		return () => document.removeEventListener("mousemove", onMove);
	}, [onBlockClick]);

	// Drop the chip when its block stops being commented (last thread resolved).
	useEffect(() => {
		if (target && !blockIds.includes(target.getAttribute(COMMENT_BLOCK_ATTR) ?? "")) {
			setTarget(null);
		}
	}, [blockIds, target]);

	// Position the chip at the hovered block's top-right, following scroll.
	useEffect(() => {
		if (!target) return;
		const update = (): void => {
			const rect = target.getBoundingClientRect();
			setPos({ top: rect.top + CHIP_EDGE_GAP, right: window.innerWidth - rect.right + CHIP_EDGE_GAP });
		};
		update();
		window.addEventListener("scroll", update, true);
		window.addEventListener("resize", update);
		return () => {
			window.removeEventListener("scroll", update, true);
			window.removeEventListener("resize", update);
		};
	}, [target]);

	if (!onBlockClick || !target) return null;

	const blockId = target.getAttribute(COMMENT_BLOCK_ATTR);
	if (!blockId) return null;

	return (
		<button
			ref={chipRef}
			type="button"
			className="bs-comment-chip"
			style={{ top: `${pos.top}px`, right: `${pos.right}px` }}
			aria-label={t("editor.comments.openThread")}
			title={t("editor.comments.openThread")}
			// Outside the contenteditable — preventDefault keeps the selection.
			onMouseDown={(event) => event.preventDefault()}
			onClick={() => onBlockClick(blockId)}
		>
			<CommentIcon />
		</button>
	);
}
