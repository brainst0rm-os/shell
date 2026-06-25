/**
 * @vitest-environment jsdom
 *
 * Citation hover popover.
 *
 * Exercises the show / hide / click-to-open lifecycle on synthetic
 * pointer events. Uses fake timers to fast-forward the open + close
 * delays, so the suite stays deterministic.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CitationEntry, CitationKind } from "../logic/citation-index";
import { attachCitationHover } from "./citation-hover";

function entry(code: string, kind: CitationKind = CitationKind.Iteration): CitationEntry {
	return {
		kind,
		key: code.toUpperCase(),
		code,
		entityId: `e-${code}`,
		entityType:
			kind === CitationKind.Iteration ? "brainstorm/Iteration/v1" : "brainstorm/OpenQuestion/v1",
		title: `Title of ${code}`,
		status: "done",
		summary: `Summary of ${code}`,
	};
}

function makeAnchor(host: HTMLElement, key: string): HTMLElement {
	const span = document.createElement("span");
	span.className = "editor__citation";
	span.setAttribute("data-citation-key", key);
	span.textContent = key;
	host.appendChild(span);
	return span;
}

describe("attachCitationHover", () => {
	let host: HTMLElement;

	beforeEach(() => {
		host = document.createElement("div");
		document.body.appendChild(host);
		vi.useFakeTimers();
	});

	afterEach(() => {
		host.remove();
		// Clean up any lingering tooltip elements between tests so a stale
		// one from a previous case doesn't fail the "dispose removes it"
		// assertion. The hover module appends each tooltip to `document.body`.
		for (const el of document.querySelectorAll(".editor__citation-tooltip")) {
			el.remove();
		}
		vi.useRealTimers();
	});

	it("delegation sanity: anchor dispatch reaches host", () => {
		let seen = false;
		host.addEventListener("pointerover", () => {
			seen = true;
		});
		const anchor = makeAnchor(host, "X");
		anchor.dispatchEvent(new Event("pointerover", { bubbles: true }));
		expect(seen).toBe(true);
	});

	it("does nothing when hovering a non-citation element", () => {
		const lookup = vi.fn();
		const open = vi.fn();
		attachCitationHover({
			host,
			lookup,
			open,
			labels: { heading: () => "Iteration", close: "X", openAction: "Open" },
		});
		const plain = document.createElement("span");
		host.appendChild(plain);
		plain.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
		vi.advanceTimersByTime(500);
		expect(lookup).not.toHaveBeenCalled();
	});

	it("shows the tooltip after the open delay", () => {
		const lookup = vi.fn(() => entry("SH-14"));
		const open = vi.fn();
		attachCitationHover({
			host,
			lookup,
			open,
			labels: { heading: () => "Iteration", close: "X", openAction: "Open" },
			openDelayMs: 50,
		});
		const anchor = makeAnchor(host, "SH-14");
		// jsdom's PointerEvent constructor doesn't always set the target
		// chain correctly for synthetic bubbling. Dispatch a normal Event
		// (closure-tracked `target` shape) — the host listener uses event
		// delegation, so the event type is what matters.
		const evt = new Event("pointerover", { bubbles: true });
		anchor.dispatchEvent(evt);
		// Before the open delay elapses, no tooltip is visible.
		const before = document.querySelector<HTMLElement>(".editor__citation-tooltip");
		expect(before?.hidden).toBe(true);
		vi.advanceTimersByTime(60);
		const after = document.querySelector<HTMLElement>(".editor__citation-tooltip");
		expect(after?.hidden).toBe(false);
		expect(after?.textContent).toContain("Title of SH-14");
		expect(lookup).toHaveBeenCalledWith("SH-14");
	});

	it("hides on pointerout after the close delay", () => {
		const lookup = vi.fn(() => entry("9.7.2"));
		attachCitationHover({
			host,
			lookup,
			open: vi.fn(),
			labels: { heading: () => "Iteration", close: "X", openAction: "Open" },
			openDelayMs: 0,
			closeDelayMs: 30,
		});
		const anchor = makeAnchor(host, "9.7.2");
		anchor.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
		vi.advanceTimersByTime(10);
		const tooltip = document.querySelector<HTMLElement>(".editor__citation-tooltip");
		expect(tooltip?.hidden).toBe(false);
		anchor.dispatchEvent(
			new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body }),
		);
		vi.advanceTimersByTime(40);
		expect(tooltip?.hidden).toBe(true);
	});

	it("opens the entry on action-button click", () => {
		const e = entry("OQ-1", CitationKind.OpenQuestion);
		const lookup = vi.fn(() => e);
		const open = vi.fn();
		attachCitationHover({
			host,
			lookup,
			open,
			labels: { heading: () => "Open question", close: "X", openAction: "Go" },
			openDelayMs: 0,
		});
		const anchor = makeAnchor(host, "OQ-1");
		anchor.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
		vi.advanceTimersByTime(5);
		const action = document.querySelector<HTMLButtonElement>(".editor__citation-tooltip__action");
		expect(action).toBeTruthy();
		action?.click();
		expect(open).toHaveBeenCalledTimes(1);
		expect(open).toHaveBeenCalledWith(e);
	});

	it("dispose() detaches listeners and removes the tooltip", () => {
		const lookup = vi.fn(() => entry("SH-14"));
		const handle = attachCitationHover({
			host,
			lookup,
			open: vi.fn(),
			labels: { heading: () => "Iteration", close: "X", openAction: "Open" },
			openDelayMs: 0,
		});
		handle.dispose();
		const anchor = makeAnchor(host, "SH-14");
		anchor.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
		vi.advanceTimersByTime(50);
		const tooltip = document.querySelector(".editor__citation-tooltip");
		expect(tooltip).toBeNull();
	});

	it("skips show when the lookup returns undefined", () => {
		const lookup = vi.fn(() => undefined);
		attachCitationHover({
			host,
			lookup,
			open: vi.fn(),
			labels: { heading: () => "Iteration", close: "X", openAction: "Open" },
			openDelayMs: 0,
		});
		const anchor = makeAnchor(host, "UNKNOWN");
		anchor.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
		vi.advanceTimersByTime(50);
		const tooltip = document.querySelector<HTMLElement>(".editor__citation-tooltip");
		expect(tooltip?.hidden).toBe(true);
	});
});
