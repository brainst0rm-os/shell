/**
 * Action command palette ranking (9.7.5) — the sibling of the quick-open
 * file palette, but over the app's invokable ACTIONS rather than its files.
 *
 * An {@link EditorCommand} is a labelled, runnable action (save, new file,
 * toggle wrap, focus references, …). Ranking reuses the same subsequence
 * `fuzzyScore` the file palette uses: the query is matched against the command
 * label AND its optional `keywords` (synonyms / verbs a user might type), and
 * the better of the two scores wins. Pure + DOM-free so it's unit-tested
 * without booting the app.
 */

import { fuzzyScore } from "./fuzzy-file";

/** Score a label against `q`. A contiguous case-insensitive substring hit
 *  scores on a high band ranked by earliness + a word-boundary nudge — so
 *  "tab" ranks "Next tab" above "Close tab" (the shared greedy `fuzzyScore`
 *  otherwise matches the early 't' in "Next" and loses consecutiveness).
 *  Non-substring subsequence matches fall back to `fuzzyScore`. */
function labelMatchScore(q: string, label: string): number | null {
	const at = label.toLowerCase().indexOf(q.toLowerCase());
	if (at >= 0) {
		const boundary = at === 0 || /\s/.test(label[at - 1] ?? "") ? 4 : 0;
		return 1000 - at + boundary;
	}
	return fuzzyScore(q, label);
}

export interface EditorCommand {
	id: string;
	label: string;
	run: () => void;
	/** Optional synonyms / verbs to match against (e.g. "explorer" for
	 *  "toggle files panel"). Joined with the label when scoring; never shown. */
	keywords?: readonly string[];
}

/**
 * Rank `commands` against `query`. An empty query returns every command in
 * input order (the palette's resting state). Otherwise only matches are kept,
 * scored by the better of their label match and their keyword match; ties
 * break toward the shorter label, then stable input order.
 */
export function rankCommands<T extends EditorCommand>(commands: readonly T[], query: string): T[] {
	const q = query.trim();
	if (q === "") return [...commands];

	const scored: { item: T; score: number; index: number }[] = [];
	for (let index = 0; index < commands.length; index++) {
		const item = commands[index];
		if (!item) continue;
		const label = labelMatchScore(q, item.label);
		const keywords = item.keywords?.length ? fuzzyScore(q, item.keywords.join(" ")) : null;
		if (label === null && keywords === null) continue;
		// The label is what people read, so a label hit outranks a keyword-only
		// hit of equal raw score.
		const score = Math.max(
			(label ?? Number.NEGATIVE_INFINITY) + 8,
			keywords ?? Number.NEGATIVE_INFINITY,
		);
		scored.push({ item, score, index });
	}

	scored.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		const lenDiff = a.item.label.length - b.item.label.length;
		if (lenDiff !== 0) return lenDiff;
		return a.index - b.index;
	});
	return scored.map((s) => s.item);
}
