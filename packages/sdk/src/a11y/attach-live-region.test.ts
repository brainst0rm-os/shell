// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { KbnAnnouncePoliteness } from "./announce-politeness";
import { attachLiveRegion } from "./attach-live-region";

/** Synchronous scheduler so the clear→write tick resolves in-test. */
const sync = (cb: () => void) => cb();

describe("attachLiveRegion", () => {
	it("creates a polite, atomic, visually-hidden region under the host", () => {
		const host = document.createElement("div");
		const handle = attachLiveRegion(host, { className: "x-live" });
		const region = host.querySelector(".x-live") as HTMLElement;
		expect(region).not.toBeNull();
		expect(region.getAttribute("aria-live")).toBe("polite");
		expect(region.getAttribute("aria-atomic")).toBe("true");
		expect(region.style.position).toBe("absolute");
		expect(region.style.overflow).toBe("hidden");
		handle.dispose();
	});

	it("honours an assertive politeness override", () => {
		const host = document.createElement("div");
		const handle = attachLiveRegion(host, {
			className: "x",
			politeness: KbnAnnouncePoliteness.Assertive,
		});
		expect((host.querySelector(".x") as HTMLElement).getAttribute("aria-live")).toBe("assertive");
		handle.dispose();
	});

	it("clears then writes the message (re-announces an identical string)", () => {
		const host = document.createElement("div");
		const handle = attachLiveRegion(host, { className: "x", schedule: sync });
		const region = host.querySelector(".x") as HTMLElement;
		handle.announce("Node A");
		expect(region.textContent).toBe("Node A");
		// Same string again still ends up written (the clear→write made it a change).
		handle.announce("Node A");
		expect(region.textContent).toBe("Node A");
		handle.dispose();
	});

	it("empty message clears without scheduling a write", () => {
		const host = document.createElement("div");
		let scheduled = 0;
		const handle = attachLiveRegion(host, {
			className: "x",
			schedule: (cb) => {
				scheduled++;
				cb();
			},
		});
		const region = host.querySelector(".x") as HTMLElement;
		handle.announce("hi");
		expect(scheduled).toBe(1);
		handle.announce("");
		expect(region.textContent).toBe("");
		expect(scheduled).toBe(1); // empty did not schedule a write
		handle.dispose();
	});

	it("a superseding announce wins over a pending write", () => {
		const host = document.createElement("div");
		const pending: Array<() => void> = [];
		const handle = attachLiveRegion(host, {
			className: "x",
			schedule: (cb) => pending.push(cb),
		});
		const region = host.querySelector(".x") as HTMLElement;
		handle.announce("first");
		handle.announce("second");
		// Flush both deferred writes in order; only the latest token wins.
		for (const cb of pending) cb();
		expect(region.textContent).toBe("second");
		handle.dispose();
	});

	it("dispose removes the element and no-ops pending writes", () => {
		const host = document.createElement("div");
		const pending: Array<() => void> = [];
		const handle = attachLiveRegion(host, {
			className: "x",
			schedule: (cb) => pending.push(cb),
		});
		handle.announce("hi");
		handle.dispose();
		expect(host.querySelector(".x")).toBeNull();
		for (const cb of pending) cb(); // must not throw / re-add text
		expect(host.querySelector(".x")).toBeNull();
	});
});
