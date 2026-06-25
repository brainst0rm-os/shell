import { afterEach, describe, expect, it } from "vitest";
import { chordIsSingleKey, matchesChord } from "./use-shortcut";

type FakeEvent = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

function evt(init: Partial<FakeEvent>): KeyboardEvent {
	const base: FakeEvent = {
		key: "",
		metaKey: false,
		ctrlKey: false,
		altKey: false,
		shiftKey: false,
		...init,
	};
	return base as KeyboardEvent;
}

const originalNavigator = (globalThis as { navigator?: Navigator }).navigator;

function setPlatform(platform: string): void {
	Object.defineProperty(globalThis, "navigator", {
		value: { platform, userAgent: "" },
		configurable: true,
		writable: true,
	});
}

afterEach(() => {
	if (originalNavigator) {
		Object.defineProperty(globalThis, "navigator", {
			value: originalNavigator,
			configurable: true,
			writable: true,
		});
	}
});

describe("matchesChord", () => {
	it("plain key matches", () => {
		expect(matchesChord(evt({ key: "Escape" }), "Escape")).toBe(true);
		expect(matchesChord(evt({ key: "Enter" }), "Enter")).toBe(true);
		expect(matchesChord(evt({ key: "ArrowDown" }), "ArrowDown")).toBe(true);
	});

	it("plain key rejects when modifier pressed", () => {
		expect(matchesChord(evt({ key: "Escape", shiftKey: true }), "Escape")).toBe(false);
		expect(matchesChord(evt({ key: "Escape", ctrlKey: true }), "Escape")).toBe(false);
	});

	it("CmdOrCtrl resolves by platform", () => {
		setPlatform("MacIntel");
		expect(matchesChord(evt({ key: "K", metaKey: true }), "CmdOrCtrl+K")).toBe(true);
		expect(matchesChord(evt({ key: "K", ctrlKey: true }), "CmdOrCtrl+K")).toBe(false);

		setPlatform("Win32");
		expect(matchesChord(evt({ key: "K", ctrlKey: true }), "CmdOrCtrl+K")).toBe(true);
		expect(matchesChord(evt({ key: "K", metaKey: true }), "CmdOrCtrl+K")).toBe(false);
	});

	it("Mod aliases CmdOrCtrl by platform (chord-capture wire form)", () => {
		setPlatform("MacIntel");
		expect(matchesChord(evt({ key: "J", metaKey: true }), "Mod+J")).toBe(true);
		// The regression: a `Mod`-tokenized rebind must NOT match a bare keystroke.
		expect(matchesChord(evt({ key: "J" }), "Mod+J")).toBe(false);
		expect(matchesChord(evt({ key: "J", ctrlKey: true }), "Mod+J")).toBe(false);

		setPlatform("Win32");
		expect(matchesChord(evt({ key: "J", ctrlKey: true }), "Mod+J")).toBe(true);
		expect(matchesChord(evt({ key: "J", metaKey: true }), "Mod+J")).toBe(false);
	});

	it("multi-modifier chords match exactly", () => {
		setPlatform("MacIntel");
		expect(matchesChord(evt({ key: "K", shiftKey: true, metaKey: true }), "CmdOrCtrl+Shift+K")).toBe(
			true,
		);
		expect(matchesChord(evt({ key: "K", metaKey: true }), "CmdOrCtrl+Shift+K")).toBe(false);
	});

	it("single-character keys are case-insensitive", () => {
		setPlatform("MacIntel");
		expect(matchesChord(evt({ key: "k", metaKey: true }), "CmdOrCtrl+K")).toBe(true);
	});

	it("Space chord matches the space key", () => {
		setPlatform("MacIntel");
		expect(matchesChord(evt({ key: " ", metaKey: true }), "CmdOrCtrl+Space")).toBe(true);
	});
});

describe("chordIsSingleKey", () => {
	it("returns true for chords with no modifier", () => {
		expect(chordIsSingleKey("?")).toBe(true);
		expect(chordIsSingleKey("Escape")).toBe(true);
		expect(chordIsSingleKey("ArrowDown")).toBe(true);
		expect(chordIsSingleKey("/")).toBe(true);
		expect(chordIsSingleKey("K")).toBe(true);
	});

	it("returns false for chords with one or more modifiers", () => {
		expect(chordIsSingleKey("CmdOrCtrl+K")).toBe(false);
		expect(chordIsSingleKey("Shift+Enter")).toBe(false);
		expect(chordIsSingleKey("Cmd+Alt+P")).toBe(false);
		expect(chordIsSingleKey("CmdOrCtrl+Shift+K")).toBe(false);
	});

	it("returns true for empty / blank chords (no parts)", () => {
		// Defensive default — the caller should never pass these, but the
		// helper shouldn't crash and shouldn't accidentally suppress.
		expect(chordIsSingleKey("")).toBe(true);
	});
});
