/**
 * NormalizeEmptyDocPlugin — guarantees an opened note is always editable,
 * never a blank void.
 *
 * A note whose body Y.Doc is empty — a stale entity from an older seeder
 * id-scheme, a plant that never ran, or a load that skipped the bootstrap —
 * would otherwise render with no blocks at all: the TitlePlugin's RootNode
 * transform only fires when an edit dirties the root, and the
 * `CollaborationPlugin` bootstrap only fires on the `sync` event with a
 * length-0 root — both can miss on initial load.
 *
 * This plugin runs ONCE, after the resolver's `whenLoaded` settles (so it
 * never races the snapshot apply — by then the real content, if any, is
 * already in the editor): if the root is empty, or has no editable block
 * after the title, it seeds a TitleNode + trailing ParagraphNode. It is
 * idempotent — a healthy doc (title + at least one more block) is left
 * untouched, so a normal open produces no write and no undo step.
 */

import { enforceTitleInvariant } from "@brainstorm/editor";
import { isUniversalBodyEmpty } from "@brainstorm/react-yjs";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createParagraphNode, $getRoot, type RootNode } from "lexical";
import { useEffect } from "react";
import type { Doc } from "yjs";
import { $seedEmptyNoteBody } from "./seed-title";

/** Make `root` editable: a completely empty root gets the canonical fresh-note
 *  shape (TitleNode bearing `titleText` + a trailing ParagraphNode); a
 *  malformed root (no title, or title-only) is repaired to "title + at least
 *  one editable block". A healthy doc is left untouched (idempotent, no write).
 *
 *  The empty-root branch shares `$seedEmptyNoteBody` with `makeNoteBootstrap`
 *  ([[seed-title]]) so this safety net and the `CollaborationPlugin` bootstrap
 *  can race freely: whichever runs first seeds the same TitleNode + paragraph
 *  from the one definition, and the other sees a non-empty root and no-ops.
 *  Pure over the live root so it's unit-testable without mounting React; the
 *  plugin calls it inside an `editor.update`. */
export function normalizeEmptyDoc(root: RootNode, titleText = ""): void {
	if (root.isEmpty()) {
		$seedEmptyNoteBody(root, titleText);
		return;
	}
	enforceTitleInvariant(root);
	if (root.getChildrenSize() < 2) {
		root.append($createParagraphNode());
	}
}

export type NormalizeEmptyDocPluginProps = {
	/** The entity's replica Y.Doc — the authority on whether the body is
	 *  *genuinely* empty (vs Lexical transiently empty mid-hydration). */
	doc: Doc;
	/** Title to seed into a genuinely-empty doc — kept identical to the
	 *  bootstrap seeder's so the two can race without diverging. */
	storedTitle: string;
	/** The resolver's load promise. The normalization waits for it so a doc
	 *  that hydrates from disk is never mistaken for empty. */
	whenLoaded?: Promise<void> | undefined;
};

export function NormalizeEmptyDocPlugin({
	doc,
	storedTitle,
	whenLoaded,
}: NormalizeEmptyDocPluginProps): null {
	const [editor] = useLexicalComposerContext();
	useEffect(() => {
		let cancelled = false;
		const normalize = (): void => {
			if (cancelled) return;
			// Authority is the Yjs body, not the Lexical root: a load race can
			// leave Lexical transiently empty while the Y.Doc already holds the
			// real content. Seeding then would clobber/duplicate it once it
			// syncs. Only a Y.Doc whose universal body is itself empty is a true
			// blank note that needs a title + paragraph to be editable. This is
			// the same length-0 gate `@lexical/yjs`'s bootstrap uses.
			let empty = false;
			try {
				empty = isUniversalBodyEmpty(doc);
			} catch {
				return;
			}
			if (!empty) return;
			editor.update(
				() => {
					normalizeEmptyDoc($getRoot(), storedTitle);
				},
				// history-merge: not a user edit, so it must not create an undo step.
				{ tag: "history-merge" },
			);
		};
		if (whenLoaded) whenLoaded.then(normalize, normalize);
		else normalize();
		return () => {
			cancelled = true;
		};
	}, [editor, doc, storedTitle, whenLoaded]);
	return null;
}
