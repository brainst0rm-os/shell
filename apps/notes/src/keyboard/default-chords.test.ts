import { describe, expect, it } from "vitest";
import { ActionId } from "./action-ids";
import { DEFAULT_CHORDS } from "./default-chords";
import { matchesActionChord } from "./use-shortcut";

/** Build a minimal KeyboardEvent-shaped object for the matcher. `mod` sets
 *  both metaKey + ctrlKey so the assertion holds regardless of the test
 *  runner's `IS_MAC` (the matcher reads one or the other per platform). */
function key(init: {
	code: string;
	key: string;
	mod?: boolean;
	shiftKey?: boolean;
	altKey?: boolean;
}): KeyboardEvent {
	return {
		code: init.code,
		key: init.key,
		ctrlKey: init.mod ?? false,
		metaKey: init.mod ?? false,
		shiftKey: init.shiftKey ?? false,
		altKey: init.altKey ?? false,
	} as KeyboardEvent;
}

describe("default chords — in-document find reservation (F-033)", () => {
	it("reserves Mod+f for the shared in-document find primitive, not the notes-list search", () => {
		// The editor mounts the shared `find-replace` FindPlugin, which owns
		// CmdOrCtrl+F (doc 59). The notes-list search must not also bind Mod+f or
		// it shadows the in-doc find bar (it did — F-033).
		expect(DEFAULT_CHORDS[ActionId.FocusNotesSearch]).not.toContain("Mod+f");
	});

	it("binds the notes-list search to Mod+Shift+F (find-across-notes convention)", () => {
		expect(DEFAULT_CHORDS[ActionId.FocusNotesSearch]).toContain("Mod+Shift+F");
	});

	it("does not bind Mod+f to any main-view note action (only the separate dictionary-editor modal may reuse it)", () => {
		const mainViewModF = (Object.entries(DEFAULT_CHORDS) as [ActionId, readonly string[]][])
			.filter(([id]) => id !== ActionId.DictionaryFocusSearch)
			.filter(([, chords]) => chords.includes("Mod+f"))
			.map(([id]) => id);
		expect(mainViewModF).toEqual([]);
	});
});

describe("default chords — print (B11.6)", () => {
	it("binds Mod+p to PrintNote (= PDF export)", () => {
		expect(DEFAULT_CHORDS[ActionId.PrintNote]).toContain("Mod+p");
	});
});

describe("default chords — page lock (B11.6 / OQ-235)", () => {
	it("binds Mod+Alt+l to ToggleNoteLock (not Mod+Shift+L — that stays on the shell appearance toggle)", () => {
		expect(DEFAULT_CHORDS[ActionId.ToggleNoteLock]).toContain("Mod+Alt+l");
		expect(DEFAULT_CHORDS[ActionId.ToggleNoteLock]).not.toContain("Mod+Shift+L");
	});

	it("matches an Option-modified Alt+L via event.code (key is a dead char on macOS)", () => {
		// Option+L emits key="¬" but code stays "KeyL"; the matcher must fall
		// back to event.code for Alt+letter chords, like it does for Alt+digit.
		const matched = matchesActionChord(
			ActionId.ToggleNoteLock,
			key({ code: "KeyL", key: "¬", mod: true, altKey: true }),
		);
		expect(matched).toBe(true);
	});

	it("does not match Alt+L without the Mod, nor a plain L", () => {
		expect(
			matchesActionChord(ActionId.ToggleNoteLock, key({ code: "KeyL", key: "¬", altKey: true })),
		).toBe(false);
		expect(matchesActionChord(ActionId.ToggleNoteLock, key({ code: "KeyL", key: "l" }))).toBe(false);
	});
});
