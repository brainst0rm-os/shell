/**
 * Daily check-in (9.16.8) — mood + habit tracking.
 *
 * Both are stored on the journal entry's property bag (like `icon`):
 * `properties.mood` is one `MoodId`, `properties.habits` is the array of
 * `HabitId`s done that day. This module is pure: the curated mood/habit
 * sets, the parse guards over whatever the vault persisted, and the toggle
 * transform. Labels are i18n keys resolved in `app.ts`; only the (locale-
 * neutral) emoji glyphs live here.
 *
 * The mood set is an ordered 5-point scale (great → bad) so a month of
 * moods reads as a heatmap on the mini-calendar. Habits are a curated
 * starter set for v1 — a user-editable habit list is a later concern.
 */

import type { JournalI18nKey } from "./journal-i18n";

export enum MoodId {
	Great = "great",
	Good = "good",
	Ok = "ok",
	Low = "low",
	Bad = "bad",
}

export type JournalMood = { id: MoodId; emoji: string };

/** Ordered best→worst — the order the picker renders and the heatmap hue
 *  scale follows. */
export const JOURNAL_MOODS: readonly JournalMood[] = Object.freeze([
	{ id: MoodId.Great, emoji: "😄" },
	{ id: MoodId.Good, emoji: "🙂" },
	{ id: MoodId.Ok, emoji: "😐" },
	{ id: MoodId.Low, emoji: "😕" },
	{ id: MoodId.Bad, emoji: "😢" },
]);

const MOOD_IDS: ReadonlySet<string> = new Set(JOURNAL_MOODS.map((m) => m.id));

/** Validate a persisted mood value down to a known `MoodId`, else null. */
export function parseMood(raw: unknown): MoodId | null {
	return typeof raw === "string" && MOOD_IDS.has(raw) ? (raw as MoodId) : null;
}

export function moodById(id: MoodId | null): JournalMood | null {
	if (id === null) return null;
	return JOURNAL_MOODS.find((m) => m.id === id) ?? null;
}

export enum HabitId {
	Exercise = "exercise",
	Read = "read",
	Meditate = "meditate",
	Outside = "outside",
	SleepWell = "sleep-well",
}

export type JournalHabit = { id: HabitId; emoji: string };

export const JOURNAL_HABITS: readonly JournalHabit[] = Object.freeze([
	{ id: HabitId.Exercise, emoji: "🏃" },
	{ id: HabitId.Read, emoji: "📖" },
	{ id: HabitId.Meditate, emoji: "🧘" },
	{ id: HabitId.Outside, emoji: "🌳" },
	{ id: HabitId.SleepWell, emoji: "😴" },
]);

const HABIT_IDS: ReadonlySet<string> = new Set(JOURNAL_HABITS.map((h) => h.id));

/** Validate a persisted habits value → a deduped array of known `HabitId`s
 *  in the canonical (display) order. Anything that isn't an array, or any
 *  unknown id, is dropped. */
export function parseHabits(raw: unknown): HabitId[] {
	if (!Array.isArray(raw)) return [];
	const seen = new Set<string>();
	for (const v of raw) {
		if (typeof v === "string" && HABIT_IDS.has(v)) seen.add(v);
	}
	return JOURNAL_HABITS.filter((h) => seen.has(h.id)).map((h) => h.id);
}

/** Toggle a habit's done state, returning a new array in canonical order. */
export function toggleHabit(habits: readonly HabitId[], id: HabitId): HabitId[] {
	const set = new Set<string>(habits);
	if (set.has(id)) set.delete(id);
	else set.add(id);
	return JOURNAL_HABITS.filter((h) => set.has(h.id)).map((h) => h.id);
}

/** Display-label i18n key per mood / habit — shared by the day check-in UI
 *  and the search-overlay filter chips. */
export const MOOD_LABEL_KEY: Record<MoodId, JournalI18nKey> = {
	[MoodId.Great]: "mood.great",
	[MoodId.Good]: "mood.good",
	[MoodId.Ok]: "mood.ok",
	[MoodId.Low]: "mood.low",
	[MoodId.Bad]: "mood.bad",
};

export const HABIT_LABEL_KEY: Record<HabitId, JournalI18nKey> = {
	[HabitId.Exercise]: "habit.exercise",
	[HabitId.Read]: "habit.read",
	[HabitId.Meditate]: "habit.meditate",
	[HabitId.Outside]: "habit.outside",
	[HabitId.SleepWell]: "habit.sleepWell",
};
