/**
 * How a journal day's body renders. Extracted as a pure decision so the
 * "which days are writable" rule is explicit + unit-tested (it used to live
 * inline in `renderEntryBody` as a today-only gate).
 *
 * The rule: an empty day is an editable placeholder on ANY date — past,
 * present, or future — as long as the surface can mutate (the first keystroke,
 * or an icon pick, mints that day's `Entry/v1` via `ensureJournalEntry(focus)`,
 * which is itself date-agnostic). Only a non-mutating surface (preview /
 * standalone, where `entities.create` is absent) stays read-only.
 *
 * This deliberately has NO date parameter: back-dating and forward-dating
 * entries are first-class, so the decision must not depend on whether the
 * focused day is "today" (the prior limitation users hit — empty past/future
 * days dropped to a dead "No entry yet." line, so typing did nothing and the
 * slash menu had no paragraph to anchor to).
 */

export enum JournalDayBodyMode {
	/** A live editor over the day's existing entry body. */
	Editor = "editor",
	/** Empty day on a mutable surface → placeholder editable; first input mints the entry. */
	ImplicitCreate = "implicit-create",
	/** Empty day on a non-mutable surface (preview / standalone) → read-only "No entry yet.". */
	ReadOnlyEmpty = "read-only-empty",
}

export function journalDayBodyMode(opts: {
	hasEntry: boolean;
	canMutate: boolean;
}): JournalDayBodyMode {
	if (opts.hasEntry) return JournalDayBodyMode.Editor;
	return opts.canMutate ? JournalDayBodyMode.ImplicitCreate : JournalDayBodyMode.ReadOnlyEmpty;
}
