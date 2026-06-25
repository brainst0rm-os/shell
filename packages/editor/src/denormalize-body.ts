/**
 * denormalize-body — THE shared editor save contract, part two.
 *
 * Every `<BrainstormEditor>` consumer persists in two layers:
 *   1. the rich body → the entity's Y.Doc → disk (automatic, via the
 *      `YDocResolver` transport — no app code needed); and
 *   2. denormalised mirrors → the entity `properties` (`title` + a
 *      length-capped plain-text `body` snippet), which feed list rows,
 *      calendar / week previews, word counts, `updatedAt`, and local
 *      search WITHOUT re-resolving the full Y.Doc replica per row.
 *
 * Layer 2 used to live inside the Notes app and was silently missing
 * (Journal) or reinvented ungated (Bookmarks) elsewhere. `denormalizeBody`
 * is the one function an app calls from its (interaction-gated)
 * `AutosavePlugin` `onChange` to produce both mirrors. Pair it with
 * `AutosavePlugin` — never a raw `OnChangePlugin` — so the mount-settle /
 * hydration echo can't fire a spurious write (the
 * `project_notes_autosave_swallows_first_edit` invariant).
 */

import type { SerializedEditorState } from "lexical";
import { DEFAULT_SNIPPET_LENGTH, clipPlainText } from "./clip-plain-text";
import { extractPlainText } from "./extract-text";
import { extractTitle } from "./extract-title";

export type DenormalizedBody = {
	/** TitleNode text, shown in headers + list rows. Empty when the body
	 *  has no title node yet. */
	title: string;
	/** Whitespace-collapsed, length-capped plain-text snippet of the whole
	 *  body — list/preview fallback + local-search substrate. */
	snippet: string;
	/** Word count over the WHOLE body — computed here from the full plain
	 *  text, NOT from the clipped `snippet`. Consumers that need a live
	 *  count (Journal footer, properties "N words") must persist + read
	 *  this; recomputing from `snippet` caps the count at `maxChars`. */
	wordCount: number;
};

export function denormalizeBody(
	state: SerializedEditorState | string | null | undefined,
	maxChars: number = DEFAULT_SNIPPET_LENGTH,
): DenormalizedBody {
	const plain = extractPlainText(state);
	return {
		title: extractTitle(state),
		snippet: clipPlainText(plain, maxChars),
		wordCount: countWords(plain),
	};
}

/** Count words in already-collapsed plain text (`extractPlainText`
 *  output is whitespace-collapsed + trimmed). Empty → 0. */
function countWords(plain: string): number {
	if (!plain) return 0;
	return plain.split(" ").length;
}
