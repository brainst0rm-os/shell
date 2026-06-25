import { describe, expect, it } from "vitest";

import { formatChord } from "./chord-display";

describe("formatChord — null + empty", () => {
	it("returns an empty array for null chord", () => {
		expect(formatChord(null, true)).toEqual([]);
		expect(formatChord(null, false)).toEqual([]);
	});

	it("returns an empty array for an all-whitespace chord", () => {
		expect(formatChord(" + + ", true)).toEqual([]);
	});
});

describe("formatChord — macOS glyphs", () => {
	it("renders CmdOrCtrl+Shift+K as glyphs", () => {
		expect(formatChord("CmdOrCtrl+Shift+K", true)).toEqual(["⌘", "⇧", "K"]);
	});

	it("renders Alt + Cmd combinations", () => {
		expect(formatChord("Alt+Cmd+P", true)).toEqual(["⌥", "⌘", "P"]);
	});

	it("normalises Ctrl/Control aliases to ⌃", () => {
		expect(formatChord("Control+K", true)).toEqual(["⌃", "K"]);
		expect(formatChord("Ctrl+K", true)).toEqual(["⌃", "K"]);
	});

	it("normalises Mod alias to ⌘ on mac", () => {
		expect(formatChord("Mod+Shift+P", true)).toEqual(["⌘", "⇧", "P"]);
	});
});

describe("formatChord — non-mac names", () => {
	it("renders CmdOrCtrl+Shift+K as Ctrl on PC", () => {
		expect(formatChord("CmdOrCtrl+Shift+K", false)).toEqual(["Ctrl", "Shift", "K"]);
	});

	it("normalises Mod alias to Ctrl on PC", () => {
		expect(formatChord("Mod+Shift+P", false)).toEqual(["Ctrl", "Shift", "P"]);
	});
});

describe("formatChord — semantic key glyphs", () => {
	it("renders arrow keys as arrows on both platforms", () => {
		expect(formatChord("CmdOrCtrl+ArrowUp", true)).toEqual(["⌘", "↑"]);
		expect(formatChord("Alt+ArrowLeft", false)).toEqual(["Alt", "←"]);
	});

	it("renders Enter / Escape / Tab with single-glyph forms", () => {
		expect(formatChord("Enter", true)).toEqual(["⏎"]);
		expect(formatChord("Escape", true)).toEqual(["Esc"]);
		expect(formatChord("Tab", false)).toEqual(["⇥"]);
	});

	it("preserves single-letter keys uppercased", () => {
		expect(formatChord("a", true)).toEqual(["A"]);
		expect(formatChord("z", false)).toEqual(["Z"]);
	});

	it("preserves multi-character non-mapped keys verbatim", () => {
		expect(formatChord("F5", true)).toEqual(["F5"]);
		expect(formatChord("PageDown", false)).toEqual(["PageDown"]);
	});
});
