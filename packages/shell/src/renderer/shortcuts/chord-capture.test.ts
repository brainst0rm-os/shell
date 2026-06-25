import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type ChordCaptureInput, captureChord } from "./chord-capture";

function withPlatform(platform: "mac" | "pc", run: () => void) {
	const original = globalThis.navigator;
	Object.defineProperty(globalThis, "navigator", {
		value: { platform: platform === "mac" ? "MacIntel" : "Win32", userAgent: "" },
		configurable: true,
	});
	try {
		run();
	} finally {
		if (original) {
			Object.defineProperty(globalThis, "navigator", { value: original, configurable: true });
		}
	}
}

const macEvent = (e: Partial<ChordCaptureInput>): ChordCaptureInput => ({ key: "", ...e });

describe("captureChord — modifier-only presses", () => {
	it("returns isModifierOnly for bare Shift", () => {
		expect(captureChord(macEvent({ key: "Shift", shiftKey: true }))).toEqual({
			chord: null,
			isModifierOnly: true,
		});
	});

	it("returns isModifierOnly for bare Meta / Control / Alt", () => {
		for (const key of ["Meta", "Control", "Alt"]) {
			expect(captureChord(macEvent({ key }))).toEqual({ chord: null, isModifierOnly: true });
		}
	});

	it("treats empty / unknown key as modifier-only so capture stays armed", () => {
		expect(captureChord(macEvent({ key: "" }))).toEqual({ chord: null, isModifierOnly: true });
		expect(captureChord(macEvent({ key: "Unidentified" }))).toEqual({
			chord: null,
			isModifierOnly: true,
		});
	});
});

describe("captureChord — Mod tokenization on mac", () => {
	beforeEach(() => {
		Object.defineProperty(globalThis, "navigator", {
			value: { platform: "MacIntel", userAgent: "" },
			configurable: true,
		});
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("maps Cmd+K (metaKey on mac) to Mod+K", () => {
		expect(captureChord({ key: "k", code: "KeyK", metaKey: true })).toEqual({
			chord: "Mod+K",
			isModifierOnly: false,
		});
	});

	it("preserves Mod / Alt / Shift order canonically", () => {
		expect(
			captureChord({ key: "p", code: "KeyP", metaKey: true, altKey: true, shiftKey: true }),
		).toEqual({ chord: "Mod+Alt+Shift+P", isModifierOnly: false });
	});

	it("uppercases layout-invariant letters via event.code (AZERTY KeyA pressed produces a)", () => {
		expect(captureChord({ key: "a", code: "KeyA", metaKey: true })).toEqual({
			chord: "Mod+A",
			isModifierOnly: false,
		});
	});

	it("digits round-trip via event.code", () => {
		expect(captureChord({ key: "3", code: "Digit3", metaKey: true })).toEqual({
			chord: "Mod+3",
			isModifierOnly: false,
		});
	});

	it("numpad digits stay distinct from digit row", () => {
		expect(captureChord({ key: "0", code: "Numpad0", metaKey: true })).toEqual({
			chord: "Mod+Numpad0",
			isModifierOnly: false,
		});
	});

	it("macOS Control is a separate modifier from Mod (⌘ vs ⌃)", () => {
		expect(captureChord({ key: "k", code: "KeyK", ctrlKey: true })).toEqual({
			chord: "Ctrl+K",
			isModifierOnly: false,
		});
		expect(captureChord({ key: "k", code: "KeyK", metaKey: true, ctrlKey: true })).toEqual({
			chord: "Mod+Ctrl+K",
			isModifierOnly: false,
		});
	});
});

describe("captureChord — Mod tokenization on PC", () => {
	beforeEach(() => {
		Object.defineProperty(globalThis, "navigator", {
			value: { platform: "Win32", userAgent: "" },
			configurable: true,
		});
	});

	it("maps Ctrl+K (ctrlKey on PC) to Mod+K", () => {
		expect(captureChord({ key: "k", code: "KeyK", ctrlKey: true })).toEqual({
			chord: "Mod+K",
			isModifierOnly: false,
		});
	});

	it("preserves Windows-key (Meta) as a separate modifier from Mod (Ctrl)", () => {
		expect(captureChord({ key: "k", code: "KeyK", metaKey: true })).toEqual({
			chord: "Meta+K",
			isModifierOnly: false,
		});
	});

	it("Ctrl + Meta on PC reads as Mod+Meta", () => {
		expect(captureChord({ key: "k", code: "KeyK", ctrlKey: true, metaKey: true })).toEqual({
			chord: "Mod+Meta+K",
			isModifierOnly: false,
		});
	});
});

describe("captureChord — semantic keys + punctuation", () => {
	it("renders Enter / Escape / Tab / Backspace / Delete via event.key", () => {
		withPlatform("mac", () => {
			expect(captureChord({ key: "Enter", metaKey: true })).toEqual({
				chord: "Mod+Enter",
				isModifierOnly: false,
			});
			expect(captureChord({ key: "Escape" })).toEqual({
				chord: "Escape",
				isModifierOnly: false,
			});
			expect(captureChord({ key: "Tab", metaKey: true, shiftKey: true })).toEqual({
				chord: "Mod+Shift+Tab",
				isModifierOnly: false,
			});
		});
	});

	it("arrow keys round-trip verbatim", () => {
		withPlatform("mac", () => {
			expect(captureChord({ key: "ArrowDown", altKey: true })).toEqual({
				chord: "Alt+ArrowDown",
				isModifierOnly: false,
			});
		});
	});

	it("Space (raw event.key === ' ') is normalized to 'Space'", () => {
		withPlatform("mac", () => {
			expect(captureChord({ key: " ", code: "Space", metaKey: true })).toEqual({
				chord: "Mod+Space",
				isModifierOnly: false,
			});
		});
	});

	it("punctuation single-chars uppercase canonically", () => {
		withPlatform("mac", () => {
			expect(captureChord({ key: "?", shiftKey: true, metaKey: true })).toEqual({
				chord: "Mod+Shift+?",
				isModifierOnly: false,
			});
			// `/` is the same physical key as `?`; capture records what the user pressed.
			expect(captureChord({ key: "/", metaKey: true })).toEqual({
				chord: "Mod+/",
				isModifierOnly: false,
			});
		});
	});

	it("F-keys ride through as-is", () => {
		withPlatform("pc", () => {
			expect(captureChord({ key: "F5" })).toEqual({ chord: "F5", isModifierOnly: false });
			expect(captureChord({ key: "F12", ctrlKey: true })).toEqual({
				chord: "Mod+F12",
				isModifierOnly: false,
			});
		});
	});

	it("multi-character non-semantic keys refuse rather than guess (IME / dead key)", () => {
		withPlatform("mac", () => {
			expect(captureChord({ key: "Process" })).toEqual({ chord: null, isModifierOnly: true });
			expect(captureChord({ key: "Dead", shiftKey: true })).toEqual({
				chord: null,
				isModifierOnly: true,
			});
		});
	});
});

describe("captureChord — round-trip with normalizeChord", () => {
	it("Mod-tokenized capture on mac and Ctrl-tokenized capture on PC normalize to the same string", async () => {
		const { normalizeChord } = await import("../../main/shortcuts/chord");
		const macSide = withPlatformReturn("mac", () =>
			captureChord({ key: "p", code: "KeyP", metaKey: true, shiftKey: true }),
		);
		const pcSide = withPlatformReturn("pc", () =>
			captureChord({ key: "p", code: "KeyP", ctrlKey: true, shiftKey: true }),
		);
		expect(macSide.chord).toBe("Mod+Shift+P");
		expect(pcSide.chord).toBe("Mod+Shift+P");
		expect(normalizeChord(macSide.chord ?? "")).toBe(normalizeChord(pcSide.chord ?? ""));
		// And both normalize to the same canonical form the install-time
		// shell-collision check uses against `CmdOrCtrl+Shift+P`.
		expect(normalizeChord(macSide.chord ?? "")).toBe(normalizeChord("CmdOrCtrl+Shift+P"));
	});
});

function withPlatformReturn<T>(platform: "mac" | "pc", run: () => T): T {
	const original = globalThis.navigator;
	Object.defineProperty(globalThis, "navigator", {
		value: { platform: platform === "mac" ? "MacIntel" : "Win32", userAgent: "" },
		configurable: true,
	});
	try {
		return run();
	} finally {
		if (original) {
			Object.defineProperty(globalThis, "navigator", { value: original, configurable: true });
		}
	}
}
