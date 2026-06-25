/**
 * Capture the renderer's `first-contentful-paint` (FCP) time in absolute
 * `Date.now()` ms so it can be compared against a process-start timestamp
 * from outside the renderer.
 *
 * `performance.getEntriesByType('paint')` returns a high-res monotonic clock
 * rooted at the navigation start of the document. The conversion is
 * `performance.timeOrigin + entry.startTime`, per the W3C spec for mapping
 * monotonic to wall-clock.
 *
 * Returns null if FCP hasn't happened by the wait timeout — the caller
 * decides whether to fail the spec or fall back to a coarser signal.
 */

import type { Page } from "@playwright/test";

export async function waitForFirstContentfulPaintAbsoluteMs(
	page: Page,
	timeoutMs = 30_000,
): Promise<number | null> {
	return page.evaluate(async (timeout) => {
		const findEntry = () =>
			performance.getEntriesByType("paint").find((e) => e.name === "first-contentful-paint") as
				| PerformanceEntry
				| undefined;

		const present = findEntry();
		if (present) return performance.timeOrigin + present.startTime;

		return new Promise<number | null>((resolve) => {
			let settled = false;
			const finish = (entry: PerformanceEntry | undefined): void => {
				if (settled) return;
				settled = true;
				observer.disconnect();
				clearTimeout(timer);
				resolve(entry ? performance.timeOrigin + entry.startTime : null);
			};
			// `buffered: true` replays already-fired entries, so the case where
			// FCP fired between findEntry() above and observer.observe() below
			// is covered without a race window.
			const observer = new PerformanceObserver((list) => {
				const fcp = list.getEntries().find((e) => e.name === "first-contentful-paint");
				if (fcp) finish(fcp);
			});
			observer.observe({ type: "paint", buffered: true });
			const timer = setTimeout(() => finish(undefined), timeout);
		});
	}, timeoutMs);
}

export async function waitForDocumentComplete(page: Page, timeoutMs = 30_000): Promise<void> {
	await page.waitForFunction(() => document.readyState === "complete", undefined, {
		timeout: timeoutMs,
	});
}
