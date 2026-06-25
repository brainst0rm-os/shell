/**
 * Journal date-key helpers — the canonical `YYYY-MM-DD` protocol the
 * Journal app uses to match `Note.title` strings to days.
 *
 * **Long-term keystone** per [[preview-drop-pattern]]: the entities-
 * service swap at 9.16.2 doesn't change the format on disk; only the
 * scan source changes (storage.kv → entities.subscribe). The key
 * format itself is shared with Tasks + Calendar's `dateKey` so a
 * cross-app "what was happening on 2026-05-14?" join is trivial.
 */

/** Canonical `YYYY-MM-DD` key (local tz) — the on-disk title shape for
 *  auto-created journal Notes. Same format as
 *  `apps/tasks/src/logic/date-buckets.ts::dateKey` + the Calendar
 *  app's. */
export function dateKeyForJournal(value: number | Date): string {
	const d = value instanceof Date ? value : new Date(value);
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

/** Parse a `YYYY-MM-DD` key back into an epoch-ms anchor at LOCAL
 *  midnight on that date. Returns `null` for anything that doesn't
 *  strictly match the format. The strict parse is deliberate: a Note
 *  titled `"2026-05-14 — gratitudes"` is NOT a journal entry — it's a
 *  user-titled note that happens to start with a date.
 *
 *  Out-of-range months (`13`, `00`) or days (`32`, `00`) round-trip
 *  into the next/previous month via the `Date` constructor; we explicitly
 *  reject those by re-formatting and comparing — the round-trip catches
 *  any normalisation the constructor did. */
export function parseJournalDateKey(key: string): number | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
	if (!match) return null;
	const [, y, m, d] = match;
	if (!y || !m || !d) return null;
	const year = Number(y);
	const month = Number(m);
	const day = Number(d);
	if (month < 1 || month > 12) return null;
	if (day < 1 || day > 31) return null;
	const probe = new Date(year, month - 1, day, 0, 0, 0, 0);
	// Reject Feb 30 / April 31 etc. — the constructor will roll them
	// forward, which would change the date silently.
	if (probe.getFullYear() !== year || probe.getMonth() + 1 !== month || probe.getDate() !== day) {
		return null;
	}
	return probe.getTime();
}

/** Stable id prefix for an auto-created journal entry: `journal-<key>`.
 *  Deterministic so the same day always maps to the same entity id (the
 *  mention/backlink edges depend on it). */
export const JOURNAL_ENTRY_ID_PREFIX = "journal-";

/** The deterministic entity id for a journal day. */
export function journalEntryIdForKey(dateKey: string): string {
	return `${JOURNAL_ENTRY_ID_PREFIX}${dateKey}`;
}

/** Decode a journal entry id (`journal-<YYYY-MM-DD>`) back to its local-
 *  midnight epoch-ms anchor, or null when the id isn't a journal entry id.
 *  Lets an incoming `open` land on the right day without a vault round-trip
 *  when the entry isn't in the loaded set. */
export function journalEntryIdToDateMs(entityId: string): number | null {
	if (!entityId.startsWith(JOURNAL_ENTRY_ID_PREFIX)) return null;
	return parseJournalDateKey(entityId.slice(JOURNAL_ENTRY_ID_PREFIX.length));
}

/** Human-friendly title for a journal entry — e.g.
 *  `"Thursday, May 14 2026"`. Used by the date navigator + window
 *  title; the on-disk `Note.title` stays the canonical `YYYY-MM-DD`. */
export function journalNoteTitle(value: number | Date): string {
	const d = value instanceof Date ? value : new Date(value);
	return d.toLocaleDateString(undefined, {
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
	});
}

/** Lexicographic comparator over date keys. Because the keys are
 *  zero-padded ISO, string-compare matches chronological order. */
export function compareJournalKeys(a: string, b: string): number {
	if (a < b) return -1;
	if (a > b) return 1;
	return 0;
}

/** True if `noteTitle` exactly matches the canonical journal-entry
 *  shape. The renderer uses this to filter the vault-wide note list
 *  down to journal entries. */
export function isJournalNoteTitle(noteTitle: string): boolean {
	return parseJournalDateKey(noteTitle) !== null;
}
