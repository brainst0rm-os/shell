/**
 * @vitest-environment jsdom
 *
 * `useShortcut` editable-focus suppression — Stage 6.10e. Pins the
 * cross-layer policy: single-key chords (no modifier) skip dispatch when
 * focus is in an editable element so the user can type the character;
 * modifier chords pass through regardless of focus.
 */

import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useShortcut } from "./use-shortcut";

// React 19 requires this flag to be set before act() is used outside the
// official testing libraries; vitest's jsdom env doesn't set it by default.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

function fireKey(target: EventTarget, init: KeyboardEventInit & { key: string }): void {
	const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
	target.dispatchEvent(event);
}

function Probe({ chord, onFire }: { chord: string; onFire: () => void }) {
	useShortcut("test/probe", onFire, { chord });
	return null;
}

describe("useShortcut — single-key chord suppression on editable focus (6.10e)", () => {
	it("fires `?` when no editable focus", () => {
		const handler = vi.fn();
		act(() => root.render(<Probe chord="?" onFire={handler} />));
		fireKey(window, { key: "?" });
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it("SKIPS `?` when fired from inside an <input type=text>", () => {
		const handler = vi.fn();
		act(() => root.render(<Probe chord="?" onFire={handler} />));
		const input = document.createElement("input");
		input.type = "text";
		document.body.appendChild(input);
		try {
			input.focus();
			fireKey(input, { key: "?" });
			expect(handler).not.toHaveBeenCalled();
		} finally {
			input.remove();
		}
	});

	it("SKIPS `?` when fired from inside a <textarea>", () => {
		const handler = vi.fn();
		act(() => root.render(<Probe chord="?" onFire={handler} />));
		const ta = document.createElement("textarea");
		document.body.appendChild(ta);
		try {
			ta.focus();
			fireKey(ta, { key: "?" });
			expect(handler).not.toHaveBeenCalled();
		} finally {
			ta.remove();
		}
	});

	it("SKIPS `?` when fired from inside [contenteditable]", () => {
		const handler = vi.fn();
		act(() => root.render(<Probe chord="?" onFire={handler} />));
		const div = document.createElement("div");
		div.setAttribute("contenteditable", "true");
		document.body.appendChild(div);
		try {
			div.focus();
			fireKey(div, { key: "?" });
			expect(handler).not.toHaveBeenCalled();
		} finally {
			div.remove();
		}
	});

	it("STILL fires `?` from a <button> (non-editable)", () => {
		const handler = vi.fn();
		act(() => root.render(<Probe chord="?" onFire={handler} />));
		const btn = document.createElement("button");
		document.body.appendChild(btn);
		try {
			btn.focus();
			fireKey(btn, { key: "?" });
			expect(handler).toHaveBeenCalledTimes(1);
		} finally {
			btn.remove();
		}
	});
});

describe("useShortcut — modifier chords always fire regardless of focus (6.10e)", () => {
	it("Cmd+? fires even when focused in an input", () => {
		const handler = vi.fn();
		act(() => root.render(<Probe chord="Cmd+?" onFire={handler} />));
		const input = document.createElement("input");
		document.body.appendChild(input);
		try {
			input.focus();
			fireKey(input, { key: "?", metaKey: true });
			expect(handler).toHaveBeenCalledTimes(1);
		} finally {
			input.remove();
		}
	});

	it("CmdOrCtrl+Shift+K fires when focused in a textarea", () => {
		// Force mac path so CmdOrCtrl resolves to meta.
		Object.defineProperty(globalThis, "navigator", {
			value: { platform: "MacIntel", userAgent: "" },
			configurable: true,
			writable: true,
		});
		const handler = vi.fn();
		act(() => root.render(<Probe chord="CmdOrCtrl+Shift+K" onFire={handler} />));
		const ta = document.createElement("textarea");
		document.body.appendChild(ta);
		try {
			ta.focus();
			fireKey(ta, { key: "K", metaKey: true, shiftKey: true });
			expect(handler).toHaveBeenCalledTimes(1);
		} finally {
			ta.remove();
		}
	});
});
