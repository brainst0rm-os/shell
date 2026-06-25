/**
 * BookmarkSuggestPlugin (9.18.2b) — the Notes "suggestion handler" the plan
 * gated this iteration on.
 *
 * Pasting a *bare* http(s) URL (the whole clipboard is one link) is NOT
 * silently auto-converted: the URL drops in as an ordinary inline link, and a
 * lightweight, non-modal affordance appears beneath it offering "Convert to
 * bookmark card" / "Keep as link". Accept resolves-or-creates a
 * `brainstorm/Bookmark/v1` entity for the URL and replaces the link's block
 * with the embedded `io.brainstorm.bookmarks/bookmark` block (the same
 * `BlockEmbedNode` path every live embed uses — `bookmark-embed.ts`). Dismiss
 * (button / Escape / outside-click / continued typing) leaves the plain link.
 *
 * Registered at HIGH priority so it owns bare-URL paste ahead of the shared
 * `EmbedPlugin` (LOW) — for Notes, a pasted link consistently becomes a link +
 * this suggestion rather than the empty-line provider chooser.
 *
 * Keyboard: accept = Enter, dismiss = Escape, both element-scoped to the
 * affordance via the shortcut registry (no raw `e.key`). The affordance is a
 * labelled `role="status"` region so a screen reader announces it on appear.
 *
 * NOT a menu: this is a two-button confirmation prompt (Convert / Keep), not a
 * "pick one of N" list, so it stays a bespoke affordance rather than moving to
 * the fancy-menus runtime. It borrows the shared `.fm-menu` glass for the
 * surface look only.
 */

import { $createLinkNode } from "@lexical/link";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
	$createTextNode,
	$getNodeByKey,
	$getSelection,
	$isElementNode,
	$isRangeSelection,
	COMMAND_PRIORITY_HIGH,
	type LexicalEditor,
	type NodeKey,
	PASTE_COMMAND,
} from "lexical";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { t } from "../i18n/t";
import { ActionId } from "../keyboard/action-ids";
import { matchesActionChord } from "../keyboard/use-shortcut";
import { getBrainstorm } from "../store/runtime";
import { insertBookmarkEmbed, resolveOrCreateBookmark } from "./bookmark-embed";
import { detectBareUrl } from "./bookmark-suggest";

const AFFORDANCE_WIDTH = 280;
const AFFORDANCE_GUTTER = 6;

type AnchorRect = { top: number; left: number; bottom: number };

type Suggestion = {
	url: string;
	/** Top-level block holding the freshly-pasted link — replaced on accept. */
	blockKey: NodeKey;
	anchor: AnchorRect;
};

export type BookmarkSuggestPluginProps = {
	/** The open note's id, threaded for parity with the other editor plugins.
	 *  Unused today (a bookmark can't reference the note), kept so the prop
	 *  shape matches and a future self-embed guard has it. */
	currentNoteId: string | null;
};

export function BookmarkSuggestPlugin(_props: BookmarkSuggestPluginProps) {
	const [editor] = useLexicalComposerContext();
	const [suggestion, setSuggestion] = useState<Suggestion | null>(null);

	const close = useCallback(() => setSuggestion(null), []);

	useEffect(() => {
		return editor.registerCommand(
			PASTE_COMMAND,
			(event: ClipboardEvent) => {
				const text = event.clipboardData?.getData("text/plain") ?? "";
				const url = detectBareUrl(text);
				if (!url) return false;
				const placed = insertPastedLink(editor, url);
				if (!placed) return false;
				event.preventDefault();
				const rect = caretRect();
				if (rect) setSuggestion({ url, blockKey: placed, anchor: rect });
				return true;
			},
			COMMAND_PRIORITY_HIGH,
		);
	}, [editor]);

	// A new paste (or programmatic doc change that removes the block) dismisses
	// a stale affordance — the prompt only makes sense for the just-pasted link.
	useEffect(() => {
		if (!suggestion) return;
		return editor.registerUpdateListener(({ editorState }) => {
			const present = editorState.read(() => $getNodeByKey(suggestion.blockKey) !== null);
			if (!present) close();
		});
	}, [editor, suggestion, close]);

	const accept = useCallback(async () => {
		if (!suggestion) return;
		const { url, blockKey } = suggestion;
		close();
		const entities = getBrainstorm()?.services.entities;
		if (!entities) {
			console.warn("[notes/bookmark-suggest] entities service unavailable — leaving the plain link.");
			return;
		}
		try {
			const resolved = await resolveOrCreateBookmark(entities, url, () => Date.now());
			await insertBookmarkEmbed(editor, getBrainstorm()?.services.blocks, blockKey, resolved);
		} catch (error) {
			console.warn("[notes/bookmark-suggest] convert failed — leaving the plain link:", error);
		}
	}, [editor, suggestion, close]);

	if (!suggestion) return null;
	return (
		<BookmarkSuggestAffordance anchor={suggestion.anchor} onAccept={accept} onDismiss={close} />
	);
}

/** Insert `url` as an inline LinkNode at the collapsed caret and return the
 *  enclosing top-level block key (the unit the embed replaces on accept), or
 *  `null` when there's no usable collapsed range selection. */
export function insertPastedLink(editor: LexicalEditor, url: string): NodeKey | null {
	let blockKey: NodeKey | null = null;
	editor.update(
		() => {
			const selection = $getSelection();
			if (!$isRangeSelection(selection)) return;
			const link = $createLinkNode(url).append($createTextNode(url));
			selection.insertNodes([link]);
			const block = link.getTopLevelElement();
			if (block && $isElementNode(block)) blockKey = block.getKey();
		},
		{ discrete: true },
	);
	return blockKey;
}

function caretRect(): AnchorRect | null {
	if (typeof window === "undefined") return null;
	const sel = window.getSelection();
	if (!sel || sel.rangeCount === 0) return null;
	const rect = sel.getRangeAt(0).cloneRange().getBoundingClientRect();
	if (!rect || (rect.top === 0 && rect.left === 0 && rect.bottom === 0 && rect.width === 0)) {
		return null;
	}
	return { top: rect.top, left: rect.left, bottom: rect.bottom };
}

function BookmarkSuggestAffordance({
	anchor,
	onAccept,
	onDismiss,
}: {
	anchor: AnchorRect;
	onAccept: () => void;
	onDismiss: () => void;
}) {
	const ref = useRef<HTMLDivElement | null>(null);
	const acceptRef = useRef<HTMLButtonElement | null>(null);
	const [style, setStyle] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

	useLayoutEffect(() => {
		const viewportW = window.innerWidth;
		const top = anchor.bottom + AFFORDANCE_GUTTER;
		const left = Math.min(Math.max(8, anchor.left), viewportW - AFFORDANCE_WIDTH - 8);
		setStyle({ top, left });
	}, [anchor]);

	useEffect(() => {
		acceptRef.current?.focus();
	}, []);

	useEffect(() => {
		function onMouseDown(event: MouseEvent) {
			if (!(event.target instanceof Node)) return;
			if (ref.current?.contains(event.target)) return;
			onDismiss();
		}
		document.addEventListener("mousedown", onMouseDown, true);
		return () => document.removeEventListener("mousedown", onMouseDown, true);
	}, [onDismiss]);

	const onKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			if (matchesActionChord(ActionId.DismissBookmarkSuggestion, event)) {
				event.preventDefault();
				onDismiss();
				return;
			}
			if (matchesActionChord(ActionId.AcceptBookmarkSuggestion, event)) {
				event.preventDefault();
				onAccept();
			}
		},
		[onAccept, onDismiss],
	);

	return (
		<div
			ref={ref}
			className="fm-menu notes__bookmark-suggest"
			role="status"
			aria-label={t("notes.bookmarkSuggest.region")}
			style={{ top: `${style.top}px`, left: `${style.left}px`, width: `${AFFORDANCE_WIDTH}px` }}
			onKeyDown={onKeyDown}
		>
			<span className="notes__bookmark-suggest-prompt">{t("notes.bookmarkSuggest.prompt")}</span>
			<div className="notes__bookmark-suggest-actions">
				<button
					ref={acceptRef}
					type="button"
					className="bs-btn bs-btn--sm"
					data-bs-primary=""
					onClick={onAccept}
				>
					{t("notes.bookmarkSuggest.accept")}
				</button>
				<button type="button" className="bs-btn bs-btn--sm" onClick={onDismiss}>
					{t("notes.bookmarkSuggest.dismiss")}
				</button>
			</div>
		</div>
	);
}
