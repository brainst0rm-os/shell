import { describe, expect, it } from "vitest";
import {
	HabitId,
	JOURNAL_HABITS,
	JOURNAL_MOODS,
	MoodId,
	moodById,
	parseHabits,
	parseMood,
	toggleHabit,
} from "./check-in";

describe("parseMood", () => {
	it("accepts a known mood id", () => {
		expect(parseMood("great")).toBe(MoodId.Great);
		expect(parseMood("bad")).toBe(MoodId.Bad);
	});

	it("rejects unknown / non-string values", () => {
		expect(parseMood("ecstatic")).toBeNull();
		expect(parseMood(3)).toBeNull();
		expect(parseMood(undefined)).toBeNull();
		expect(parseMood(null)).toBeNull();
	});
});

describe("moodById", () => {
	it("resolves the glyph for a mood", () => {
		expect(moodById(MoodId.Ok)?.emoji).toBe("😐");
	});
	it("returns null for no mood", () => {
		expect(moodById(null)).toBeNull();
	});
});

describe("parseHabits", () => {
	it("keeps known ids in canonical order, dropping unknowns + dupes", () => {
		expect(parseHabits(["read", "exercise", "read", "bogus"])).toEqual([
			HabitId.Exercise,
			HabitId.Read,
		]);
	});

	it("returns empty for a non-array", () => {
		expect(parseHabits("read")).toEqual([]);
		expect(parseHabits(undefined)).toEqual([]);
	});
});

describe("toggleHabit", () => {
	it("adds a habit not present", () => {
		expect(toggleHabit([HabitId.Read], HabitId.Exercise)).toEqual([HabitId.Exercise, HabitId.Read]);
	});

	it("removes a habit already present", () => {
		expect(toggleHabit([HabitId.Read, HabitId.Exercise], HabitId.Read)).toEqual([HabitId.Exercise]);
	});

	it("keeps the result in canonical order regardless of toggle order", () => {
		let h: HabitId[] = [];
		h = toggleHabit(h, HabitId.SleepWell);
		h = toggleHabit(h, HabitId.Exercise);
		h = toggleHabit(h, HabitId.Outside);
		expect(h).toEqual(JOURNAL_HABITS.filter((x) => h.includes(x.id)).map((x) => x.id));
		expect(h).toEqual([HabitId.Exercise, HabitId.Outside, HabitId.SleepWell]);
	});
});

describe("curated sets", () => {
	it("expose unique ids and are frozen", () => {
		expect(new Set(JOURNAL_MOODS.map((m) => m.id)).size).toBe(JOURNAL_MOODS.length);
		expect(new Set(JOURNAL_HABITS.map((h) => h.id)).size).toBe(JOURNAL_HABITS.length);
		expect(Object.isFrozen(JOURNAL_MOODS)).toBe(true);
		expect(Object.isFrozen(JOURNAL_HABITS)).toBe(true);
	});
});
