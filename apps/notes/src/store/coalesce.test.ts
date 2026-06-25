import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTrailingCoalescer } from "./coalesce";

describe("createTrailingCoalescer", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("fires the run once, delayMs after a single schedule", () => {
		const run = vi.fn();
		const c = createTrailingCoalescer(run, 250);

		c.schedule();
		vi.advanceTimersByTime(249);
		expect(run).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(run).toHaveBeenCalledTimes(1);
	});

	it("collapses a burst of schedules into a single trailing run", () => {
		const run = vi.fn();
		const c = createTrailingCoalescer(run, 250);

		c.schedule();
		vi.advanceTimersByTime(100);
		c.schedule();
		vi.advanceTimersByTime(100);
		c.schedule();
		expect(run).not.toHaveBeenCalled();
		vi.advanceTimersByTime(250);
		expect(run).toHaveBeenCalledTimes(1);
	});

	it("never fires after cancel — the unmount-within-window leak", () => {
		const run = vi.fn();
		const c = createTrailingCoalescer(run, 250);

		c.schedule();
		c.cancel();
		vi.advanceTimersByTime(1000);
		expect(run).not.toHaveBeenCalled();
	});

	it("cancel is idempotent and safe with nothing pending", () => {
		const run = vi.fn();
		const c = createTrailingCoalescer(run, 250);

		expect(() => {
			c.cancel();
			c.cancel();
		}).not.toThrow();
		expect(run).not.toHaveBeenCalled();
	});
});
