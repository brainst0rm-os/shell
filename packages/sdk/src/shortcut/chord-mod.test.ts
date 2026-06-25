import { describe, expect, it } from "vitest";
import { matchesChord } from "./chord";

function ev(
	key: string,
	mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {},
) {
	return {
		key,
		metaKey: !!mods.metaKey,
		ctrlKey: !!mods.ctrlKey,
		altKey: !!mods.altKey,
		shiftKey: !!mods.shiftKey,
	} as unknown as KeyboardEvent;
}

describe("matchesChord — Mod modifier", () => {
	it("'Mod+a' must NOT match a plain 'a' keystroke (regression: block select-all fired on typing)", () => {
		expect(matchesChord(ev("a"), "Mod+a")).toBe(false);
	});

	it("'Mod+d' must NOT match a plain 'd' keystroke (block duplicate fired on typing)", () => {
		expect(matchesChord(ev("d"), "Mod+d")).toBe(false);
	});

	const isMac =
		typeof navigator !== "undefined" &&
		/mac|iphone|ipad/i.test(navigator.platform ?? navigator.userAgent);
	const modKey = isMac ? { metaKey: true } : { ctrlKey: true };

	it("'Mod+a' matches the platform mod + a (Cmd on mac, Ctrl elsewhere)", () => {
		expect(matchesChord(ev("a", modKey), "Mod+a")).toBe(true);
	});

	it("'Mod+Shift+ArrowUp' needs the modifier", () => {
		expect(matchesChord(ev("ArrowUp", { shiftKey: true }), "Mod+Shift+ArrowUp")).toBe(false);
		expect(matchesChord(ev("ArrowUp", { ...modKey, shiftKey: true }), "Mod+Shift+ArrowUp")).toBe(
			true,
		);
	});
});
