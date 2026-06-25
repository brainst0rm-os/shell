// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KbnAnnouncePoliteness } from "./announce-politeness";
import { LiveRegion, _resetLiveRegionForTests, announce } from "./live-region";

async function flushMicrotasks(): Promise<void> {
	// `announce` defers the write via `queueMicrotask` so the AT sees an
	// empty→message transition. The test waits one microtask tick.
	await Promise.resolve();
	await Promise.resolve();
}

describe("LiveRegion + announce()", () => {
	let host: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		_resetLiveRegionForTests();
		host = document.createElement("div");
		document.body.appendChild(host);
		root = createRoot(host);
	});

	afterEach(() => {
		act(() => root.unmount());
		host.remove();
		_resetLiveRegionForTests();
	});

	const polite = () => host.querySelector<HTMLElement>('[data-testid="bs-live-region-polite"]');
	const assertive = () =>
		host.querySelector<HTMLElement>('[data-testid="bs-live-region-assertive"]');

	it("mounts a polite + an assertive live region", () => {
		act(() => root.render(<LiveRegion />));
		expect(polite()?.getAttribute("aria-live")).toBe(KbnAnnouncePoliteness.Polite);
		expect(polite()?.getAttribute("role")).toBe("status");
		expect(assertive()?.getAttribute("aria-live")).toBe(KbnAnnouncePoliteness.Assertive);
		expect(assertive()?.getAttribute("role")).toBe("alert");
	});

	it("polite announcement writes to the status region", async () => {
		act(() => root.render(<LiveRegion />));
		announce("Saved");
		await flushMicrotasks();
		expect(polite()?.textContent).toBe("Saved");
		expect(assertive()?.textContent).toBe("");
	});

	it("assertive announcement writes to the alert region", async () => {
		act(() => root.render(<LiveRegion />));
		announce("Vault locked", { politeness: KbnAnnouncePoliteness.Assertive });
		await flushMicrotasks();
		expect(assertive()?.textContent).toBe("Vault locked");
		expect(polite()?.textContent).toBe("");
	});

	it("pre-mount calls are queued and flushed when LiveRegion mounts", async () => {
		announce("First");
		announce("Second", { politeness: KbnAnnouncePoliteness.Assertive });
		act(() => root.render(<LiveRegion />));
		await flushMicrotasks();
		// Last polite + last assertive should be visible — both got flushed,
		// each routed to its own region.
		expect(polite()?.textContent).toBe("First");
		expect(assertive()?.textContent).toBe("Second");
	});

	it("pre-mount ring caps at 10 — older entries drop", async () => {
		for (let i = 0; i < 15; i++) announce(`msg-${i}`);
		act(() => root.render(<LiveRegion />));
		await flushMicrotasks();
		// After flushing all 10 surviving entries (msg-5 … msg-14), the last
		// flush wins on the polite region. msg-14 should be the final state.
		expect(polite()?.textContent).toBe("msg-14");
	});

	it("repeated identical announcement is observable as a change (clear-then-write)", async () => {
		act(() => root.render(<LiveRegion />));
		announce("Same");
		await flushMicrotasks();
		expect(polite()?.textContent).toBe("Same");
		announce("Same");
		// Synchronously, before the microtask, the region is cleared first.
		expect(polite()?.textContent).toBe("");
		await flushMicrotasks();
		expect(polite()?.textContent).toBe("Same");
	});

	it("empty-string announcement is a no-op", async () => {
		act(() => root.render(<LiveRegion />));
		announce("Real");
		await flushMicrotasks();
		announce("");
		await flushMicrotasks();
		expect(polite()?.textContent).toBe("Real");
	});

	it("unmount clears the module-scope ref; subsequent announces queue again", async () => {
		act(() => root.render(<LiveRegion />));
		announce("Live");
		await flushMicrotasks();
		expect(polite()?.textContent).toBe("Live");
		act(() => root.unmount());
		// New announce while unmounted goes into the queue.
		announce("Queued");
		// Re-mount and verify flush.
		const host2 = document.createElement("div");
		document.body.appendChild(host2);
		const root2 = createRoot(host2);
		act(() => root2.render(<LiveRegion />));
		await flushMicrotasks();
		expect(host2.querySelector('[data-testid="bs-live-region-polite"]')?.textContent).toBe("Queued");
		act(() => root2.unmount());
		host2.remove();
	});
});
