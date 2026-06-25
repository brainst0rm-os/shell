/**
 * useShortcut — minimal in-app shortcut hook. Mirrors the shell's
 * `useShortcut(id, handler)` so CLAUDE.md's "no raw e.key" rule holds in
 * apps too. Handlers receive the KeyboardEvent so they can decide
 * whether to preventDefault.
 *
 * Future: when the SDK ships a `ui.shortcuts` service, this hook
 * delegates to it. For now it owns a document-level keydown listener
 * (scoped via DEFAULT_CHORDS lookup so unrelated keys don't fire it).
 */

import { useEffect } from "react";
import type { ActionId } from "./action-ids";
import { DEFAULT_CHORDS } from "./default-chords";

const IS_MAC = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

export function useShortcut(id: ActionId, handler: (event: KeyboardEvent) => void): void {
	useEffect(() => {
		const chords = DEFAULT_CHORDS[id];
		if (!chords || chords.length === 0) return;
		function onKeydown(event: KeyboardEvent) {
			for (const chord of chords) {
				if (matchesChord(chord, event)) {
					handler(event);
					return;
				}
			}
		}
		// Capture phase so we run before Lexical's contenteditable handlers
		// and can preventDefault on chords like Cmd+A / ArrowUp / Backspace
		// when block selection is active.
		document.addEventListener("keydown", onKeydown, true);
		return () => document.removeEventListener("keydown", onKeydown, true);
	}, [id, handler]);
}

/** Element-scoped variant: tests whether a KeyboardEvent matches any
 *  chord bound to `id`. Used by inputs / popovers that want native
 *  focus-scoped delivery (the document-level listener above isn't
 *  appropriate when many inputs would share the same chord).
 *
 *  Reads from the same `DEFAULT_CHORDS` table so the chord set stays
 *  one source of truth; no raw `e.key` strings outside this module. */
export function matchesActionChord(
	id: ActionId,
	event: KeyboardEvent | React.KeyboardEvent,
): boolean {
	const chords = DEFAULT_CHORDS[id];
	if (!chords || chords.length === 0) return false;
	const native = "nativeEvent" in event ? event.nativeEvent : event;
	for (const chord of chords) {
		if (matchesChord(chord, native)) return true;
	}
	return false;
}

function matchesChord(chord: string, event: KeyboardEvent): boolean {
	const parts = chord.split("+").map((p) => p.trim());
	const key = parts.pop();
	if (!key) return false;
	const wantMod = parts.some((p) => p === "Mod" || p === "Cmd" || p === "Ctrl");
	const wantShift = parts.includes("Shift");
	const wantAlt = parts.includes("Alt");
	const hasMod = IS_MAC ? event.metaKey : event.ctrlKey;
	// Alt/Option + a digit or letter produces an Option-modified `event.key`
	// on macOS (`Option+1` → "¡", `Option+l` → "¬"), so for those chords fall
	// back to the layout-stable `event.code` ("Digit1" / "KeyL"). Plain
	// (non-Alt) chords keep matching `event.key`.
	const keyMatches =
		event.key === key ||
		(wantAlt && /^[0-9]$/.test(key) && event.code === `Digit${key}`) ||
		(wantAlt && /^[a-z]$/i.test(key) && event.code === `Key${key.toUpperCase()}`);
	return (
		keyMatches && wantMod === hasMod && wantShift === event.shiftKey && wantAlt === event.altKey
	);
}
