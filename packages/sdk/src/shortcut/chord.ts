/**
 * Host-agnostic chord layer — ported verbatim from the shell's
 * `renderer/shortcuts/use-shortcut.ts` (`matchesChord` / `normalizeKey`),
 * same semantics, same `isMac` detection, same `CmdOrCtrl` resolution.
 *
 * Apps supply the chord string directly (`"Escape"`, `"CmdOrCtrl+K"`,
 * `"Shift+Enter"`); there is no dependency on the shell's `default-chords`
 * registry. Keeping the parser identical to the shell's means an app's
 * binding contract matches the shell's the day the live override stream
 * (a later shell iteration) reaches apps.
 *
 * Chord format: `[<Mod>+]<Key>` where `<Mod>` is one or more of
 * `CmdOrCtrl`, `Cmd`, `Ctrl`, `Alt`, `Shift` joined by `+`, and `<Key>` is
 * the canonical key name (`Escape`, `Enter`, `ArrowDown`, `Space`, `A`, …).
 */

/** Check whether a browser KeyboardEvent satisfies a chord string. */
export function matchesChord(event: KeyboardEvent, chord: string): boolean {
	const parts = chord.split("+").map((p) => p.trim());
	const key = parts[parts.length - 1];
	if (!key) return false;
	const mods = parts.slice(0, -1);

	const isMac =
		typeof navigator !== "undefined" &&
		/mac|iphone|ipad/i.test(navigator.platform ?? navigator.userAgent);

	// `Mod` is the canonical cross-platform modifier token the chord-capture
	// system emits (Cmd on mac, Ctrl elsewhere) — the same semantics as
	// `CmdOrCtrl`. Treat them as aliases. Without this, `Mod+a` parsed to
	// "no modifier + a", so it matched a PLAIN `a` keystroke — typing `a`/`c`/
	// `d`/`x`/`v` in the editor fired the block select-all/copy/duplicate/
	// cut/paste chords (`useEditorShortcut`, which has no editable-field
	// suppression). See `chord-mod.test.ts`.
	const wantMeta = mods.includes("CmdOrCtrl") || mods.includes("Mod");
	const wantCmd = mods.includes("Cmd") || (wantMeta && isMac);
	const wantCtrl = mods.includes("Ctrl") || (wantMeta && !isMac);
	const wantAlt = mods.includes("Alt");
	const wantShift = mods.includes("Shift");

	if (!!event.metaKey !== wantCmd) return false;
	if (!!event.ctrlKey !== wantCtrl) return false;
	if (!!event.altKey !== wantAlt) return false;
	if (!!event.shiftKey !== wantShift) return false;

	return normalizeKey(event.key) === normalizeKey(key);
}

export function normalizeKey(key: string): string {
	if (key === " ") return "Space";
	if (key.length === 1) return key.toUpperCase();
	return key;
}

/** A chord is "single-key" when it has no `Cmd`/`Ctrl`/`Alt`/`CmdOrCtrl`/
 *  `Mod` modifier. Used by `attachShortcut` to skip dispatch into editable
 *  fields (same rule as the shell's renderer-side `useShortcut`). Bare
 *  `Shift+Enter` counts as single-key for this check — it is still a
 *  printable gesture inside a text field. (`Mod` is the cross-platform
 *  Cmd/Ctrl alias; omitting it here made `Mod+…` chords look single-key and
 *  get suppressed in text fields, so real `Cmd+a` never reached them.) */
export function chordIsSingleKey(chord: string): boolean {
	const parts = chord.split("+").map((p) => p.trim());
	if (parts.length <= 1) return true;
	const mods = parts.slice(0, -1);
	for (const m of mods) {
		if (m === "Cmd" || m === "Ctrl" || m === "Alt" || m === "CmdOrCtrl" || m === "Mod") return false;
	}
	return true;
}
