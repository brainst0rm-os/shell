// @vitest-environment jsdom
/**
 * Chord matcher table + the DOM `attachShortcut` and React `useShortcut`
 * delivery rule. The matcher is ported verbatim from the shell hook, so
 * the table pins the same `CmdOrCtrl` / case / Space semantics.
 */

import { act } from "react";
import { createRef } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachShortcut } from "./attach-shortcut";
import { chordIsSingleKey, matchesChord, normalizeKey } from "./chord";
import { _resetShortcutSuppressionForTests, registerShortcutSuppression } from "./suppression";
import { useShortcut } from "./use-shortcut";

function ev(init: Partial<KeyboardEventInit> & { key: string }): KeyboardEvent {
	return new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
}

describe("normalizeKey", () => {
	it.each([
		[" ", "Space"],
		["a", "A"],
		["Z", "Z"],
		["Escape", "Escape"],
		["ArrowDown", "ArrowDown"],
	])("normalizes %j -> %j", (input, out) => {
		expect(normalizeKey(input)).toBe(out);
	});
});

describe("matchesChord", () => {
	const orig = Object.getOwnPropertyDescriptor(navigator, "platform");
	afterEach(() => {
		if (orig) Object.defineProperty(navigator, "platform", orig);
	});

	it.each([
		["Escape", { key: "Escape" }, true],
		["Escape", { key: "Enter" }, false],
		["Shift+Enter", { key: "Enter", shiftKey: true }, true],
		["Shift+Enter", { key: "Enter" }, false],
		["A", { key: "a" }, true],
		["A", { key: "a", metaKey: true }, false],
		["Ctrl+K", { key: "k", ctrlKey: true }, true],
		["Space", { key: " " }, true],
		["", { key: "Escape" }, false],
	])("%s vs %o => %s", (chord, init, expected) => {
		expect(matchesChord(ev(init as { key: string }), chord)).toBe(expected);
	});

	it("resolves CmdOrCtrl to Meta on mac and Ctrl off mac", () => {
		Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
		expect(matchesChord(ev({ key: "k", metaKey: true }), "CmdOrCtrl+K")).toBe(true);
		expect(matchesChord(ev({ key: "k", ctrlKey: true }), "CmdOrCtrl+K")).toBe(false);
		Object.defineProperty(navigator, "platform", { value: "Win32", configurable: true });
		expect(matchesChord(ev({ key: "k", ctrlKey: true }), "CmdOrCtrl+K")).toBe(true);
		expect(matchesChord(ev({ key: "k", metaKey: true }), "CmdOrCtrl+K")).toBe(false);
	});
});

describe("attachShortcut", () => {
	it("invokes the handler and prevents default on a match, disposer detaches", () => {
		const handler = vi.fn();
		const dispose = attachShortcut(window, "CmdOrCtrl+S", handler);
		const e = ev({ key: "s", metaKey: true, ctrlKey: false });
		Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
		window.dispatchEvent(e);
		expect(handler).toHaveBeenCalledTimes(1);
		expect(e.defaultPrevented).toBe(true);
		dispose();
		window.dispatchEvent(ev({ key: "s", metaKey: true }));
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it("ignores already-handled events and respects enabled:false", () => {
		const handler = vi.fn();
		const d1 = attachShortcut(window, "Escape", handler, { enabled: false });
		window.dispatchEvent(ev({ key: "Escape" }));
		expect(handler).not.toHaveBeenCalled();
		d1();

		const h2 = vi.fn();
		const d2 = attachShortcut(window, "Escape", h2);
		const handled = ev({ key: "Escape" });
		handled.preventDefault();
		window.dispatchEvent(handled);
		expect(h2).not.toHaveBeenCalled();
		d2();
	});

	it("scopes to an element target", () => {
		const el = document.createElement("div");
		document.body.appendChild(el);
		const handler = vi.fn();
		const dispose = attachShortcut(el, "Enter", handler);
		el.dispatchEvent(ev({ key: "Enter" }));
		expect(handler).toHaveBeenCalledTimes(1);
		dispose();
		el.remove();
	});

	describe("single-key suppression rule", () => {
		afterEach(() => {
			_resetShortcutSuppressionForTests();
		});

		it("skips single-key chords when focus is on a text input", () => {
			const input = document.createElement("input");
			input.type = "text";
			document.body.appendChild(input);
			input.focus();
			const handler = vi.fn();
			const dispose = attachShortcut(window, "T", handler);
			input.dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true, cancelable: true }));
			expect(handler).not.toHaveBeenCalled();
			dispose();
			input.remove();
		});

		it("skips single-key chords when focus is in a contenteditable", () => {
			const div = document.createElement("div");
			div.setAttribute("contenteditable", "true");
			document.body.appendChild(div);
			div.focus();
			const handler = vi.fn();
			const dispose = attachShortcut(window, "D", handler);
			div.dispatchEvent(new KeyboardEvent("keydown", { key: "d", bubbles: true, cancelable: true }));
			expect(handler).not.toHaveBeenCalled();
			dispose();
			div.remove();
		});

		it("still delivers modifier chords inside an editable", () => {
			Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
			const input = document.createElement("input");
			input.type = "text";
			document.body.appendChild(input);
			input.focus();
			const handler = vi.fn();
			const dispose = attachShortcut(window, "CmdOrCtrl+F", handler);
			input.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "f",
					metaKey: true,
					bubbles: true,
					cancelable: true,
				}),
			);
			expect(handler).toHaveBeenCalledTimes(1);
			dispose();
			input.remove();
		});

		it("skips single-key chords while a suppression source is active", () => {
			const handler = vi.fn();
			const dispose = attachShortcut(window, "W", handler);
			let menuOpen = false;
			const release = registerShortcutSuppression(() => menuOpen);
			menuOpen = true;
			window.dispatchEvent(ev({ key: "w" }));
			expect(handler).not.toHaveBeenCalled();
			menuOpen = false;
			window.dispatchEvent(ev({ key: "w" }));
			expect(handler).toHaveBeenCalledTimes(1);
			release();
			dispose();
		});

		it("allowWhileSuppressed lets the caller opt out", () => {
			const handler = vi.fn();
			const release = registerShortcutSuppression(() => true);
			const dispose = attachShortcut(window, "Escape", handler, {
				allowWhileSuppressed: true,
			});
			window.dispatchEvent(ev({ key: "Escape" }));
			expect(handler).toHaveBeenCalledTimes(1);
			release();
			dispose();
		});

		it("chordIsSingleKey: modifier chords are not single-key", () => {
			expect(chordIsSingleKey("T")).toBe(true);
			expect(chordIsSingleKey("Escape")).toBe(true);
			expect(chordIsSingleKey("Shift+Enter")).toBe(true);
			expect(chordIsSingleKey("CmdOrCtrl+F")).toBe(false);
			expect(chordIsSingleKey("Cmd+K")).toBe(false);
			expect(chordIsSingleKey("Ctrl+Shift+P")).toBe(false);
			expect(chordIsSingleKey("Alt+ArrowLeft")).toBe(false);
		});
	});
});

describe("useShortcut", () => {
	let host: HTMLDivElement;
	let root: Root;
	beforeEach(() => {
		host = document.createElement("div");
		document.body.appendChild(host);
		root = createRoot(host);
	});
	afterEach(() => {
		act(() => root.unmount());
		host.remove();
	});

	it("binds globally and detaches on unmount", () => {
		const handler = vi.fn();
		function H() {
			useShortcut("Escape", handler);
			return null;
		}
		act(() => root.render(<H />));
		act(() => {
			window.dispatchEvent(ev({ key: "Escape" }));
		});
		expect(handler).toHaveBeenCalledTimes(1);
		act(() => root.unmount());
		act(() => {
			window.dispatchEvent(ev({ key: "Escape" }));
		});
		expect(handler).toHaveBeenCalledTimes(1);
		root = createRoot(host);
	});

	it("scopes to a ref and honours enabled:false", () => {
		const handler = vi.fn();
		const ref = createRef<HTMLDivElement>();
		function H({ on }: { on: boolean }) {
			return (
				<div ref={ref} tabIndex={-1}>
					<Inner on={on} />
				</div>
			);
		}
		function Inner({ on }: { on: boolean }) {
			useShortcut("Enter", handler, {
				target: { kind: "scope", ref },
				enabled: on,
			});
			return null;
		}
		act(() => root.render(<H on={false} />));
		act(() => {
			ref.current?.dispatchEvent(ev({ key: "Enter" }));
		});
		expect(handler).not.toHaveBeenCalled();
		act(() => root.render(<H on={true} />));
		act(() => {
			ref.current?.dispatchEvent(ev({ key: "Enter" }));
		});
		expect(handler).toHaveBeenCalledTimes(1);
	});
});
