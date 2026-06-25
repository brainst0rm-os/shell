/**
 * B11.1 — date mentions: `@today` / `@tomorrow` / `@yesterday` / an ISO
 * `YYYY-MM-DD` typed in the `@` typeahead resolve to a typed date ref (a
 * `YYYY-MM-DD` the chip stores + a human label the chip shows).
 *
 * This is the pure resolver half — no Lexical, no DOM, `now` injected so the
 * relative keywords are deterministic. The typeahead surfaces
 * `dateMentionCandidates` as options alongside entity matches; selecting one
 * inserts the chip (the editor-integration follow-up). Keeping the date math
 * here makes the keyword/offset/ISO-validation logic exhaustively unit-
 * testable on its own.
 *
 * Dates are resolved in **local** calendar time (the user's "today"); the ISO
 * is the local `YYYY-MM-DD`, matching how the Calendar app keys days.
 */

/** A resolved date reference: the stored ISO day + the chip's display label. */
export type DateMention = { iso: string; label: string };

type Keyword = { key: string; offset: number; label: string };

/** Relative keywords, in the order the typeahead lists them. */
const KEYWORDS: readonly Keyword[] = [
	{ key: "today", offset: 0, label: "Today" },
	{ key: "tomorrow", offset: 1, label: "Tomorrow" },
	{ key: "yesterday", offset: -1, label: "Yesterday" },
];

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function pad2(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}

/** Local `YYYY-MM-DD` for `now` shifted by `offsetDays` calendar days.
 *  `setDate` crosses month / year / DST boundaries correctly. */
function isoForOffset(now: number, offsetDays: number): string {
	const d = new Date(now);
	d.setDate(d.getDate() + offsetDays);
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** A `YYYY-MM-DD` string that names a real calendar day (rejects `2024-13-40`,
 *  `2025-02-30`, …) — the parsed date must round-trip to the same fields. */
function isValidIso(iso: string): boolean {
	if (!ISO_RE.test(iso)) return false;
	const [y, m, d] = iso.split("-").map((s) => Number.parseInt(s, 10)) as [number, number, number];
	const date = new Date(y, m - 1, d);
	return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/**
 * Resolve a typeahead query (the text after `@`) to a date ref, or `null` when
 * it isn't a date mention. Exact keyword match (`today`/`tomorrow`/
 * `yesterday`, case-insensitive) or a valid ISO `YYYY-MM-DD`.
 */
export function resolveDateMention(query: string, now: number): DateMention | null {
	const q = query.trim().toLowerCase();
	if (q.length === 0) return null;
	const kw = KEYWORDS.find((k) => k.key === q);
	if (kw) return { iso: isoForOffset(now, kw.offset), label: kw.label };
	if (isValidIso(q)) return { iso: q, label: q };
	return null;
}

/**
 * The date options to show in the `@` typeahead for a partial query: the
 * relative keywords whose name prefix-matches `query` (all of them on an empty
 * query), plus the query itself when it's already a valid ISO day.
 */
export function dateMentionCandidates(query: string, now: number): DateMention[] {
	const q = query.trim().toLowerCase();
	const out: DateMention[] = [];
	for (const k of KEYWORDS) {
		if (q.length === 0 || k.key.startsWith(q)) {
			out.push({ iso: isoForOffset(now, k.offset), label: k.label });
		}
	}
	if (isValidIso(q)) out.push({ iso: q, label: q });
	return out;
}
