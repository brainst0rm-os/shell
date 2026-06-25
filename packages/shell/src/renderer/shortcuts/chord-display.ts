/**
 * Chord display helpers — convert `"CmdOrCtrl+Shift+K"` strings into the
 * platform-appropriate glyph tokens a renderer surface presents as `<kbd>`
 * elements.
 *
 * Shared between Settings → Keyboard ([keyboard-section.tsx](../settings/keyboard-section.tsx))
 * and the 6.9 cheatsheet overlay; per CLAUDE.md "Two call sites doing
 * similar things go through the same helper" — three is a hard ceiling,
 * and this is already the second.
 *
 * Glyph maps:
 *   - macOS: standard Apple meta-key glyphs (⌘ / ⌃ / ⌥ / ⇧).
 *   - Other platforms: the verbatim modifier names (`Ctrl`, `Alt`, `Shift`).
 *   - Common semantic keys (`Enter`, `Escape`, arrows, `Tab`, `Backspace`,
 *     `Delete`) get a single-glyph rendering.
 */

const MAC_GLYPHS: Record<string, string> = {
	cmdorctrl: "⌘",
	cmd: "⌘",
	command: "⌘",
	meta: "⌘",
	mod: "⌘",
	ctrl: "⌃",
	control: "⌃",
	alt: "⌥",
	option: "⌥",
	shift: "⇧",
};

const PC_NAMES: Record<string, string> = {
	cmdorctrl: "Ctrl",
	cmd: "Cmd",
	command: "Cmd",
	meta: "Meta",
	mod: "Ctrl",
	ctrl: "Ctrl",
	control: "Ctrl",
	alt: "Alt",
	option: "Alt",
	shift: "Shift",
};

const KEY_GLYPHS: Record<string, string> = {
	arrowup: "↑",
	arrowdown: "↓",
	arrowleft: "←",
	arrowright: "→",
	enter: "⏎",
	escape: "Esc",
	space: "Space",
	tab: "⇥",
	backspace: "⌫",
	delete: "Del",
};

/** True when the current renderer is on macOS. Defaults to `false` in
 *  non-DOM contexts (SSR / tests without a navigator stub) so the PC
 *  display is the conservative fallback. */
export function isMacPlatform(): boolean {
	if (typeof navigator === "undefined") return false;
	return /mac|iphone|ipad/i.test(navigator.platform ?? navigator.userAgent);
}

/** Split a `"CmdOrCtrl+Shift+K"` chord into platform-appropriate display
 *  tokens. Returns an empty array for `null` (the action exists but has
 *  no chord — render as "unbound"). Tokens are ready to drop into
 *  `<kbd>` elements; the caller owns the markup choice. */
export function formatChord(chord: string | null, mac: boolean): ReadonlyArray<string> {
	if (chord === null) return [];
	const parts = chord
		.split("+")
		.map((p) => p.trim())
		.filter(Boolean);
	const out: string[] = [];
	for (const raw of parts) {
		const lower = raw.toLowerCase();
		if (mac && lower in MAC_GLYPHS) {
			const glyph = MAC_GLYPHS[lower];
			if (glyph) out.push(glyph);
			continue;
		}
		if (!mac && lower in PC_NAMES) {
			const name = PC_NAMES[lower];
			if (name) out.push(name);
			continue;
		}
		const keyGlyph = KEY_GLYPHS[lower];
		if (keyGlyph) {
			out.push(keyGlyph);
			continue;
		}
		out.push(raw.length === 1 ? raw.toUpperCase() : raw);
	}
	return out;
}
