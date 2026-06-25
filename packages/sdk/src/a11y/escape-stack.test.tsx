// @vitest-environment jsdom
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEscapeStack, installEscapeHandler } from "./escape-stack";
import { useEscapeStackEntry } from "./use-escape-stack-entry";

function Entry({
	onEscape,
	enabled = true,
	label,
}: {
	onEscape: () => void;
	enabled?: boolean;
	label?: string;
}) {
	useEscapeStackEntry({ onEscape, enabled, ...(label !== undefined ? { label } : {}) });
	return null;
}

function pressEscape(target: EventTarget = document) {
	const ev = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
	target.dispatchEvent(ev);
	return ev;
}

describe("useEscapeStackEntry", () => {
	let host: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		getEscapeStack().clear();
		host = document.createElement("div");
		document.body.appendChild(host);
		root = createRoot(host);
	});

	afterEach(() => {
		act(() => root.unmount());
		host.remove();
		getEscapeStack().clear();
	});

	it("pushes on mount and pops on unmount", () => {
		const fn = vi.fn();
		act(() => root.render(<Entry onEscape={fn} />));
		expect(getEscapeStack().size()).toBe(1);
		act(() => root.unmount());
		expect(getEscapeStack().size()).toBe(0);
	});

	it("preserves LIFO ordering across nested mounts", () => {
		const fnOuter = vi.fn();
		const fnInner = vi.fn();
		act(() =>
			root.render(
				<>
					<Entry onEscape={fnOuter} label="outer" />
					<Entry onEscape={fnInner} label="inner" />
				</>,
			),
		);
		expect(getEscapeStack().size()).toBe(2);
		expect(getEscapeStack().peek()?.openerLabel).toBe("inner");
	});

	it("out-of-order unmount preserves the topmost entry", () => {
		// Render two entries, then remove the OUTER one; INNER must remain on top.
		function Pair({ outerEnabled }: { outerEnabled: boolean }) {
			return (
				<>
					{outerEnabled && <Entry onEscape={() => {}} label="outer" />}
					<Entry onEscape={() => {}} label="inner" />
				</>
			);
		}
		act(() => root.render(<Pair outerEnabled={true} />));
		expect(getEscapeStack().size()).toBe(2);
		act(() => root.render(<Pair outerEnabled={false} />));
		expect(getEscapeStack().size()).toBe(1);
		expect(getEscapeStack().peek()?.openerLabel).toBe("inner");
	});

	it("flipping enabled false→true re-pushes; true→false pops", () => {
		function Toggle({ enabled }: { enabled: boolean }) {
			return <Entry enabled={enabled} onEscape={() => {}} label="toggle" />;
		}
		act(() => root.render(<Toggle enabled={false} />));
		expect(getEscapeStack().size()).toBe(0);
		act(() => root.render(<Toggle enabled={true} />));
		expect(getEscapeStack().size()).toBe(1);
		act(() => root.render(<Toggle enabled={false} />));
		expect(getEscapeStack().size()).toBe(0);
	});

	it("StrictMode double-mount settles with exactly one entry", () => {
		act(() =>
			root.render(
				<React.StrictMode>
					<Entry onEscape={() => {}} label="strict" />
				</React.StrictMode>,
			),
		);
		expect(getEscapeStack().size()).toBe(1);
		expect(getEscapeStack().peek()?.openerLabel).toBe("strict");
	});

	it("calls the latest onEscape even when callback identity changes between renders", () => {
		const first = vi.fn();
		const second = vi.fn();
		function Wrapper({ cb }: { cb: () => void }) {
			return <Entry onEscape={cb} />;
		}
		act(() => root.render(<Wrapper cb={first} />));
		act(() => root.render(<Wrapper cb={second} />));
		expect(getEscapeStack().size()).toBe(1);
		const top = getEscapeStack().peek();
		top?.onEscape();
		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledTimes(1);
	});
});

describe("installEscapeHandler", () => {
	let uninstall: () => void = () => {};

	beforeEach(() => {
		getEscapeStack().clear();
	});

	afterEach(() => {
		uninstall();
		getEscapeStack().clear();
	});

	it("routes Escape to the top of the stack and stops propagation", () => {
		const top = vi.fn();
		const stack = getEscapeStack();
		stack.push({ id: "a", onEscape: top });
		uninstall = installEscapeHandler(stack);

		const bubbled = vi.fn();
		document.addEventListener("keydown", bubbled);
		const ev = pressEscape();
		document.removeEventListener("keydown", bubbled);

		expect(top).toHaveBeenCalledTimes(1);
		expect(ev.defaultPrevented).toBe(true);
		// stopPropagation in the capture phase means the bubble-phase listener
		// never fires for the same event.
		expect(bubbled).not.toHaveBeenCalled();
	});

	it("lets Escape continue when the stack is empty", () => {
		uninstall = installEscapeHandler(getEscapeStack());
		const bubbled = vi.fn();
		document.addEventListener("keydown", bubbled);
		const ev = pressEscape();
		document.removeEventListener("keydown", bubbled);
		expect(ev.defaultPrevented).toBe(false);
		expect(bubbled).toHaveBeenCalledTimes(1);
	});

	it("invokes onEmptyStack exactly once per Escape when empty", () => {
		const onEmptyStack = vi.fn();
		uninstall = installEscapeHandler(getEscapeStack(), { onEmptyStack });
		pressEscape();
		expect(onEmptyStack).toHaveBeenCalledTimes(1);
		pressEscape();
		expect(onEmptyStack).toHaveBeenCalledTimes(2);
	});

	it("does NOT invoke onEmptyStack when an entry was on top", () => {
		const onEmptyStack = vi.fn();
		getEscapeStack().push({ id: "a", onEscape: () => {} });
		uninstall = installEscapeHandler(getEscapeStack(), { onEmptyStack });
		pressEscape();
		expect(onEmptyStack).not.toHaveBeenCalled();
	});

	it("ignores non-Escape keys", () => {
		const top = vi.fn();
		getEscapeStack().push({ id: "a", onEscape: top });
		uninstall = installEscapeHandler(getEscapeStack());
		const ev = new KeyboardEvent("keydown", {
			key: "Enter",
			bubbles: true,
			cancelable: true,
		});
		document.dispatchEvent(ev);
		expect(top).not.toHaveBeenCalled();
		expect(ev.defaultPrevented).toBe(false);
	});

	it("uninstall removes the listener", () => {
		const top = vi.fn();
		getEscapeStack().push({ id: "a", onEscape: top });
		const off = installEscapeHandler(getEscapeStack());
		off();
		pressEscape();
		expect(top).not.toHaveBeenCalled();
	});

	it("end-to-end: hook entry + handler — pressing Escape closes the top overlay", () => {
		let host: HTMLDivElement | null = null;
		let root: Root | null = null;
		const onClose = vi.fn();
		try {
			host = document.createElement("div");
			document.body.appendChild(host);
			root = createRoot(host);
			act(() => root?.render(<Entry onEscape={onClose} />));
			uninstall = installEscapeHandler(getEscapeStack());
			pressEscape();
			expect(onClose).toHaveBeenCalledTimes(1);
		} finally {
			if (root) act(() => root?.unmount());
			host?.remove();
		}
	});
});
