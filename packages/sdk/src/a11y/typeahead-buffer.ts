/**
 * Typeahead buffer used by `useCompositeKeyboard` — owns the ≤500ms reset
 * window from `61-keyboard-accessibility.md §Composite-listbox conventions`.
 * Pure: no DOM, no React, no document-level listeners. Each `append(char)`
 * call extends the buffer when within `resetMs` of the previous keystroke and
 * starts fresh otherwise; the resolver (`getLabel`) is consulted to find the
 * first matching item.
 *
 * Matching policy: the buffer is prefix-matched against each item's label,
 * case-insensitively. A repeated single character (typing "aaa" while the
 * list has many items starting with "a") cycles through "a"-prefix items —
 * we detect the all-same-character buffer and treat it as a "next-of-prefix"
 * cycle starting from `indexHint + 1`. Anything else is a normal prefix
 * search from index 0. This mirrors the de-facto WAI-ARIA behaviour and is
 * how every native composite (`<select>`, file managers, listboxes) responds.
 */

const DEFAULT_RESET_MS = 500;

export type TypeaheadBufferOptions = {
	getLabel: (index: number) => string;
	count: () => number;
	resetMs?: number;
	now?: () => number;
};

export type TypeaheadAppendResult = {
	readonly index: number | null;
	readonly buffer: string;
};

export interface TypeaheadBuffer {
	append(char: string, indexHint: number): TypeaheadAppendResult;
	reset(): void;
}

function isAllSameChar(s: string): boolean {
	if (s.length <= 1) return true;
	const first = s[0] as string;
	for (let i = 1; i < s.length; i++) {
		if (s[i] !== first) return false;
	}
	return true;
}

function normaliseChar(char: string): string {
	// Caller is expected to pass exactly one printable code point; we lower-case
	// for case-insensitive matching. Reject anything that isn't a single grapheme
	// (defensive — the DOM-side mapper already filters control keys).
	return char.toLowerCase();
}

export function createTypeaheadBuffer(options: TypeaheadBufferOptions): TypeaheadBuffer {
	const resetMs = options.resetMs ?? DEFAULT_RESET_MS;
	const now = options.now ?? (() => Date.now());
	let buffer = "";
	let lastAt = 0;

	const findPrefix = (needle: string, startIdx: number): number => {
		const total = options.count();
		if (total <= 0 || needle.length === 0) return -1;
		for (let step = 0; step < total; step++) {
			const i = (startIdx + step) % total;
			const label = options.getLabel(i).toLowerCase();
			if (label.startsWith(needle)) return i;
		}
		return -1;
	};

	return {
		append(rawChar, indexHint) {
			const char = normaliseChar(rawChar);
			if (char.length === 0) return { index: null, buffer };
			const t = now();
			if (t - lastAt > resetMs) buffer = "";
			buffer = buffer + char;
			lastAt = t;
			// Repeated-character path: cycle through items starting with the
			// repeated letter, skipping the current index so the user steps
			// forward each press.
			if (isAllSameChar(buffer)) {
				const startIdx = Math.max(0, indexHint + 1);
				const found = findPrefix(char, startIdx);
				return { index: found < 0 ? null : found, buffer };
			}
			const found = findPrefix(buffer, 0);
			return { index: found < 0 ? null : found, buffer };
		},
		reset() {
			buffer = "";
			lastAt = 0;
		},
	};
}
