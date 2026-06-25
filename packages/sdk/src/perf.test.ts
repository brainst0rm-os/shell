import { afterEach, describe, expect, it, vi } from "vitest";
import { clearRecent, measure, now, recent, subscribe, time, timeAsync } from "./perf";

describe("perf helper", () => {
	afterEach(() => clearRecent());

	it("records a measure for a sync block and returns the value", () => {
		const v = time("t.sync", () => 41 + 1);
		expect(v).toBe(42);
		const r = recent();
		expect(r.at(-1)?.name).toBe("t.sync");
		expect(r.at(-1)?.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("records a measure even when fn throws", () => {
		expect(() =>
			time("t.throws", () => {
				throw new Error("boom");
			}),
		).toThrow("boom");
		expect(recent().at(-1)?.name).toBe("t.throws");
	});

	it("records an async measure", async () => {
		const v = await timeAsync("t.async", async () => {
			await new Promise((r) => setTimeout(r, 1));
			return "ok";
		});
		expect(v).toBe("ok");
		const last = recent().at(-1);
		expect(last?.name).toBe("t.async");
		expect(last?.durationMs).toBeGreaterThan(0);
	});

	it("notifies subscribers above thresholdMs only", () => {
		const cb = vi.fn();
		const unsub = subscribe({ thresholdMs: 5 }, cb);
		const start = now();
		measure("under", start, start + 1);
		measure("over", start, start + 10);
		expect(cb).toHaveBeenCalledTimes(1);
		expect(cb.mock.calls[0]?.[0].name).toBe("over");
		unsub();
	});

	it("filters subscribers by prefix", () => {
		const cb = vi.fn();
		const unsub = subscribe({ prefix: "db." }, cb);
		const start = now();
		measure("editor.x", start, start + 50);
		measure("db.compile", start, start + 50);
		expect(cb).toHaveBeenCalledTimes(1);
		expect(cb.mock.calls[0]?.[0].name).toBe("db.compile");
		unsub();
	});

	it("ring buffer keeps last N", () => {
		clearRecent();
		for (let i = 0; i < 200; i++) measure(`m${i}`, 0, 1);
		const r = recent();
		expect(r.length).toBeLessThanOrEqual(64);
		expect(r.at(-1)?.name).toBe("m199");
	});

	it("subscriber errors don't poison the call site", () => {
		const unsub = subscribe({}, () => {
			throw new Error("subscriber blew up");
		});
		expect(() => time("safe", () => 1)).not.toThrow();
		unsub();
	});
});
