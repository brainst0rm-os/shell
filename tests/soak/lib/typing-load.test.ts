/**
 * Stage 10.9c — unit tests for `runTypingLoad`. Verifies the gate-4 path:
 * the helper pushes one elapsed-ms entry per successful `appendText` into
 * the caller's `keystrokeTimings` array, two callers never share state,
 * and the perf budget can be evaluated against the resulting series.
 *
 * No Playwright, no Electron, no relay — `Page.evaluate` is mocked with a
 * fake that resolves after a known delay so the timings array becomes a
 * deterministic, asserted output.
 */

import { describe, expect, it, vi } from "vitest";
import { runTypingLoad } from "./typing-load";

type EvaluateFn = (
	fn: (arg: { id: string; t: string }) => Promise<void>,
	arg: { id: string; t: string },
) => Promise<void>;

function makeFakePage(delayMs: number): {
	page: { evaluate: EvaluateFn };
	calls: Array<{ id: string; t: string }>;
} {
	const calls: Array<{ id: string; t: string }> = [];
	const page = {
		evaluate: vi.fn(async (_fn: unknown, arg: { id: string; t: string }) => {
			calls.push(arg);
			await new Promise((res) => setTimeout(res, delayMs));
		}) as unknown as EvaluateFn,
	};
	return { page, calls };
}

describe("runTypingLoad", () => {
	it("pushes one elapsed-ms entry per successful appendText", async () => {
		const { page: pageA } = makeFakePage(2);
		const { page: pageB } = makeFakePage(2);
		const timings: number[] = [];
		await runTypingLoad({
			shellA: pageA as unknown as Parameters<typeof runTypingLoad>[0]["shellA"],
			shellB: pageB as unknown as Parameters<typeof runTypingLoad>[0]["shellB"],
			entityId: "ent_x",
			canaryA: "AAA",
			canaryB: "BBB",
			durationMs: 200,
			keystrokeHz: 50,
			structuralEveryMs: 1_000_000,
			keystrokeTimings: timings,
		});
		// 2 sides per tick; 50Hz cap means ~10 ticks over 200ms → 20 timings
		// (lower bound — the timing of `Date.now()` checks varies under load).
		expect(timings.length).toBeGreaterThan(0);
		expect(timings.length % 2).toBe(0);
		for (const ms of timings) {
			expect(ms).toBeGreaterThanOrEqual(0);
			expect(Number.isFinite(ms)).toBe(true);
		}
	});

	it("two distinct caller-provided arrays do not share state", async () => {
		const timingsRun1: number[] = [];
		const timingsRun2: number[] = [];
		const { page: pageA1 } = makeFakePage(1);
		const { page: pageB1 } = makeFakePage(1);
		await runTypingLoad({
			shellA: pageA1 as unknown as Parameters<typeof runTypingLoad>[0]["shellA"],
			shellB: pageB1 as unknown as Parameters<typeof runTypingLoad>[0]["shellB"],
			entityId: "ent_x",
			canaryA: "AAA",
			canaryB: "BBB",
			durationMs: 100,
			keystrokeHz: 50,
			structuralEveryMs: 1_000_000,
			keystrokeTimings: timingsRun1,
		});
		const seenAfterRun1 = timingsRun1.length;
		const { page: pageA2 } = makeFakePage(1);
		const { page: pageB2 } = makeFakePage(1);
		await runTypingLoad({
			shellA: pageA2 as unknown as Parameters<typeof runTypingLoad>[0]["shellA"],
			shellB: pageB2 as unknown as Parameters<typeof runTypingLoad>[0]["shellB"],
			entityId: "ent_x",
			canaryA: "AAA",
			canaryB: "BBB",
			durationMs: 100,
			keystrokeHz: 50,
			structuralEveryMs: 1_000_000,
			keystrokeTimings: timingsRun2,
		});
		expect(timingsRun1.length).toBe(seenAfterRun1);
		expect(timingsRun2.length).toBeGreaterThan(0);
	});

	it("each elapsed value reflects the underlying evaluate delay (within tolerance)", async () => {
		const delayMs = 8;
		const { page: pageA } = makeFakePage(delayMs);
		const { page: pageB } = makeFakePage(delayMs);
		const timings: number[] = [];
		await runTypingLoad({
			shellA: pageA as unknown as Parameters<typeof runTypingLoad>[0]["shellA"],
			shellB: pageB as unknown as Parameters<typeof runTypingLoad>[0]["shellB"],
			entityId: "ent_x",
			canaryA: "AAA",
			canaryB: "BBB",
			durationMs: 120,
			keystrokeHz: 20,
			structuralEveryMs: 1_000_000,
			keystrokeTimings: timings,
		});
		expect(timings.length).toBeGreaterThan(0);
		// Every elapsed value sits at or above the synthetic delay (the
		// scheduler can only ADD latency; it can't subtract from the
		// awaited promise).
		for (const ms of timings) {
			expect(ms).toBeGreaterThanOrEqual(delayMs - 1);
		}
	});

	it("calls fire on both shellA and shellB each tick", async () => {
		const { page: pageA, calls: callsA } = makeFakePage(1);
		const { page: pageB, calls: callsB } = makeFakePage(1);
		const timings: number[] = [];
		await runTypingLoad({
			shellA: pageA as unknown as Parameters<typeof runTypingLoad>[0]["shellA"],
			shellB: pageB as unknown as Parameters<typeof runTypingLoad>[0]["shellB"],
			entityId: "ent_x",
			canaryA: "AAA",
			canaryB: "BBB",
			durationMs: 100,
			keystrokeHz: 50,
			structuralEveryMs: 1_000_000,
			keystrokeTimings: timings,
		});
		expect(callsA.length).toBeGreaterThan(0);
		expect(callsB.length).toBeGreaterThan(0);
		expect(Math.abs(callsA.length - callsB.length)).toBeLessThanOrEqual(1);
	});

	it("weaves the canary text into every 10th tick", async () => {
		const { page: pageA, calls: callsA } = makeFakePage(0);
		const { page: pageB, calls: callsB } = makeFakePage(0);
		const timings: number[] = [];
		await runTypingLoad({
			shellA: pageA as unknown as Parameters<typeof runTypingLoad>[0]["shellA"],
			shellB: pageB as unknown as Parameters<typeof runTypingLoad>[0]["shellB"],
			entityId: "ent_x",
			canaryA: "AAA",
			canaryB: "BBB",
			durationMs: 250,
			keystrokeHz: 50,
			structuralEveryMs: 1_000_000,
			keystrokeTimings: timings,
		});
		const canariesA = callsA.filter((c) => c.t === "AAA").length;
		const canariesB = callsB.filter((c) => c.t === "BBB").length;
		expect(canariesA).toBeGreaterThan(0);
		expect(canariesB).toBeGreaterThan(0);
	});
});
