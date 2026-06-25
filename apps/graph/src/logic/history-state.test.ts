import { describe, expect, it } from "vitest";
import { HistoryReveal } from "../types/graph-view";
import {
	DEFAULT_HISTORY_ANIMATION_STATE,
	captureHistoryState,
	restoreHistoryState,
} from "./history-state";

describe("restoreHistoryState", () => {
	it("non-object / null → the default (history off)", () => {
		for (const bad of [null, undefined, 42, "x", []]) {
			expect(restoreHistoryState(bad)).toEqual(DEFAULT_HISTORY_ANIMATION_STATE);
		}
	});

	it("round-trips a valid block and derives `enabled` from cutoffAt", () => {
		const s = restoreHistoryState({
			enabled: true,
			startAt: 1000,
			endAt: 5000,
			cutoffAt: 3000,
			speed: 4,
			reveal: HistoryReveal.Recent,
		});
		expect(s).toEqual({
			enabled: true,
			startAt: 1000,
			endAt: 5000,
			cutoffAt: 3000,
			speed: 4,
			reveal: HistoryReveal.Recent,
		});
	});

	it("a null cutoff means history off regardless of a stale `enabled`", () => {
		const s = restoreHistoryState({ enabled: true, cutoffAt: null, speed: 2 });
		expect(s.enabled).toBe(false);
		expect(s.cutoffAt).toBeNull();
	});

	it("clamps a bad / non-positive speed to 1 and a bad reveal to Eased", () => {
		expect(restoreHistoryState({ cutoffAt: 1, speed: 0 }).speed).toBe(1);
		expect(restoreHistoryState({ cutoffAt: 1, speed: -3 }).speed).toBe(1);
		expect(restoreHistoryState({ cutoffAt: 1, speed: Number.NaN }).speed).toBe(1);
		expect(restoreHistoryState({ cutoffAt: 1, reveal: "bogus" }).reveal).toBe(HistoryReveal.Eased);
		expect(restoreHistoryState({ cutoffAt: 1 }).reveal).toBe(HistoryReveal.Eased);
	});

	it("coerces non-finite / non-number cutoff & bounds to null", () => {
		const s = restoreHistoryState({ cutoffAt: "5", startAt: Number.POSITIVE_INFINITY, endAt: {} });
		expect(s.cutoffAt).toBeNull();
		expect(s.startAt).toBeNull();
		expect(s.endAt).toBeNull();
	});
});

describe("captureHistoryState", () => {
	it("enabled mirrors cutoffAt; bounds populate start/end", () => {
		const s = captureHistoryState({
			cutoffAt: 2500,
			speed: 8,
			reveal: HistoryReveal.Strict,
			bounds: { min: 1000, max: 9000 },
		});
		expect(s).toEqual({
			enabled: true,
			startAt: 1000,
			endAt: 9000,
			cutoffAt: 2500,
			speed: 8,
			reveal: HistoryReveal.Strict,
		});
	});

	it("null cutoff + null bounds → history-off shape", () => {
		const s = captureHistoryState({
			cutoffAt: null,
			speed: 1,
			reveal: HistoryReveal.Eased,
			bounds: null,
		});
		expect(s.enabled).toBe(false);
		expect(s.startAt).toBeNull();
		expect(s.endAt).toBeNull();
		expect(s.cutoffAt).toBeNull();
	});

	it("sanitises a bad speed / reveal on the way out too", () => {
		const s = captureHistoryState({
			cutoffAt: 1,
			speed: 0,
			reveal: "nope" as unknown as HistoryReveal,
			bounds: null,
		});
		expect(s.speed).toBe(1);
		expect(s.reveal).toBe(HistoryReveal.Eased);
	});

	it("capture → restore is a fixpoint", () => {
		const captured = captureHistoryState({
			cutoffAt: 4242,
			speed: 16,
			reveal: HistoryReveal.Recent,
			bounds: { min: 100, max: 8000 },
		});
		expect(restoreHistoryState(captured)).toEqual(captured);
	});
});
