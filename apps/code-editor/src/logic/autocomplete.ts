/**
 * Buffer-driven autocomplete (9.7.3 — completions).
 *
 * The native `<textarea>` has no completion model, so candidates are
 * computed here and painted by the pane's overlay popup; accepting one
 * routes through {@link applyCompletion}, which produces ONE new buffer
 * string (one `input` dispatch → one Y.Text transaction, the same shape
 * the multi-cursor + line-op edits use). The v1 source is language-
 * agnostic "complete from buffer" (every identifier already in the
 * document), with an optional injected keyword list layered in so a
 * language map can be added later without touching the core.
 *
 * Pure — no DOM. All offsets are absolute buffer offsets.
 */

import { wordRangeAt } from "./multi-cursor";

export enum CompletionKind {
	/** An identifier harvested from the document. */
	Word = "word",
	/** A language keyword from the injected list. */
	Keyword = "keyword",
}

export interface CompletionItem {
	/** Display + match text. */
	label: string;
	/** Text written into the buffer on accept (currently === label). */
	insertText: string;
	kind: CompletionKind;
}

export interface CompletionResult {
	/** Inclusive start of the word range a chosen item replaces. */
	from: number;
	/** Exclusive end of that range. */
	to: number;
	/** Ranked, de-duplicated, capped candidate list (never empty). */
	items: CompletionItem[];
}

export interface CompletionOptions {
	/** Language keywords offered alongside buffer identifiers. */
	keywords?: readonly string[];
	/** Don't offer completions until the typed prefix is this long. */
	minPrefix?: number;
	/** Hard cap on the returned list. */
	maxItems?: number;
}

const DEFAULT_MIN_PREFIX = 1;
const DEFAULT_MAX_ITEMS = 12;
/** Identifier-shaped runs: a letter/underscore lead, then word chars.
 *  Excludes pure numbers so `42` never becomes a candidate. */
const IDENTIFIER = /[\p{L}_][\p{L}\p{N}_]*/gu;
/** Single-char identifiers carry no completion value as candidates. */
const MIN_CANDIDATE_LENGTH = 2;

/**
 * The word range the caret sits in plus the prefix typed BEFORE the
 * caret (what completion matches against). Returns null when the caret
 * has no preceding word characters in its word — there is nothing to
 * complete.
 */
export function completionPrefix(
	text: string,
	caret: number,
): { prefix: string; from: number; to: number } | null {
	const word = wordRangeAt(text, caret);
	if (!word) return null;
	if (caret <= word.from) return null;
	return { prefix: text.slice(word.from, caret), from: word.from, to: word.to };
}

/** Every identifier in the buffer mapped to its occurrence count. */
export function bufferIdentifiers(text: string): Map<string, number> {
	const counts = new Map<string, number>();
	for (const match of text.matchAll(IDENTIFIER)) {
		const token = match[0];
		if (token.length < MIN_CANDIDATE_LENGTH) continue;
		counts.set(token, (counts.get(token) ?? 0) + 1);
	}
	return counts;
}

/**
 * Compute the completion list for the caret, or null when there is
 * nothing to offer (no prefix, prefix below threshold, or no candidate
 * survives filtering). The candidate already fully typed under the caret
 * is excluded — completing a word to itself is a no-op.
 *
 * Ranking, in order: a case-sensitive prefix match outranks a
 * case-insensitive-only one; then higher buffer frequency (keywords have
 * none, so document identifiers — the local context — come first); then
 * the shorter label; then alphabetical, for a stable order.
 */
export function computeCompletions(
	text: string,
	caret: number,
	options: CompletionOptions = {},
): CompletionResult | null {
	const minPrefix = options.minPrefix ?? DEFAULT_MIN_PREFIX;
	const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;

	const located = completionPrefix(text, caret);
	if (!located || located.prefix.length < minPrefix) return null;

	const { prefix, from, to } = located;
	const lowerPrefix = prefix.toLowerCase();
	const currentWord = text.slice(from, to);

	const wordCounts = bufferIdentifiers(text);
	const seen = new Set<string>();
	const scored: { item: CompletionItem; caseExact: boolean; freq: number }[] = [];

	const consider = (label: string, kind: CompletionKind, freq: number): void => {
		if (label === currentWord) return;
		if (label.length < lowerPrefix.length) return;
		if (!label.toLowerCase().startsWith(lowerPrefix)) return;
		if (seen.has(label)) return;
		seen.add(label);
		scored.push({
			item: { label, insertText: label, kind },
			caseExact: label.startsWith(prefix),
			freq,
		});
	};

	for (const [label, count] of wordCounts) consider(label, CompletionKind.Word, count);
	for (const keyword of options.keywords ?? []) consider(keyword, CompletionKind.Keyword, 0);

	if (scored.length === 0) return null;

	scored.sort(
		(a, b) =>
			Number(b.caseExact) - Number(a.caseExact) ||
			b.freq - a.freq ||
			a.item.label.length - b.item.label.length ||
			a.item.label.localeCompare(b.item.label),
	);

	return { from, to, items: scored.slice(0, maxItems).map((s) => s.item) };
}

/**
 * Accept a completion: replace the result's word range with the item's
 * text, returning the new buffer and the caret position after it (one
 * new buffer string → one input dispatch, matching the edit-fan-out
 * shape the other affordances use).
 */
export function applyCompletion(
	text: string,
	result: Pick<CompletionResult, "from" | "to">,
	item: Pick<CompletionItem, "insertText">,
): { text: string; caret: number } {
	const out = text.slice(0, result.from) + item.insertText + text.slice(result.to);
	return { text: out, caret: result.from + item.insertText.length };
}
