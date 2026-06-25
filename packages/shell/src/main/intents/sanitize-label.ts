/**
 * Bounded plain-text sanitization for any app/contributor-declared string the
 * shell renders or feeds to a model (action labels — doc 63 §Security — and the
 * platform catalog the Agent reads — doc 63 / Agent context layer). Strip
 * control chars + angle brackets (no markup, no control smuggling), collapse
 * whitespace, and cap the length so a declaration can't blow out a menu row,
 * smuggle markup, or pad the agent's context window.
 */

/** Maximum rendered length of a contributed action's label (doc 63 §Security). */
export const MAX_ACTION_LABEL_LENGTH = 64;

/** Sanitize a declared string to a bounded plain string: strip control chars +
 *  angle brackets, collapse whitespace, cap at `maxLen` (eliding with `…`).
 *  Returns `undefined` for a missing / empty / all-stripped value so callers can
 *  fall back. The shell paints this, never the declarer's raw string. */
export function sanitizeBoundedText(
	raw: string | null | undefined,
	maxLen: number,
): string | undefined {
	if (!raw) return undefined;
	const cleaned = raw
		// Drop ASCII control chars and angle brackets (no markup, no control
		// smuggling); each becomes a space so words don't fuse together.
		// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars is the security intent.
		.replace(/[\x00-\x1f\x7f<>]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (cleaned.length === 0) return undefined;
	return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen - 1).trimEnd()}…` : cleaned;
}

/** Sanitize a contributor-declared action label (doc 63 §Security). */
export function sanitizeActionLabel(raw: string | null): string | undefined {
	return sanitizeBoundedText(raw, MAX_ACTION_LABEL_LENGTH);
}
