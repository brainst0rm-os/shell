/**
 * Low-level coercion primitives shared by every app's persistence codec.
 * Domain parsing (URL normalization, recurrence rules, whiteboard node
 * dispatch) stays per-app — these are just the leaf guards that turn an
 * `unknown` field off a stored record into a typed value or `null`.
 *
 * Extracted because `nullableString` / `nullableNumber` were defined
 * byte-for-byte in the Bookmarks, Calendar, and Tasks codecs, and the
 * `typeof v === "string" && LIST.includes(v)` enum guard recurred across
 * Whiteboard's node-field coercions.
 */

/** A finite `number`, or `null` for anything else (incl. NaN / ±Infinity,
 *  `null`, `undefined`, non-numbers). */
export function nullableNumber(v: unknown): number | null {
	if (v === null || v === undefined) return null;
	if (typeof v !== "number" || !Number.isFinite(v)) return null;
	return v;
}

/** A `string`, or `null` for anything else. */
export function nullableString(v: unknown): string | null {
	if (v === null || v === undefined) return null;
	if (typeof v !== "string") return null;
	return v;
}

/** `v` when it's one of `allowed` (a known string-enum value set), else
 *  `null`. The wire format stays strings; this narrows back to the enum. */
export function coerceEnum<T extends string>(v: unknown, allowed: readonly T[]): T | null {
	return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}
