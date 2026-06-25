/**
 * Pure chord-normalization shared by the shortcut registry (runtime match)
 * and the manifest validator (install-time collision detection).
 *
 * Modifier synonyms collapse to canonical names so `Cmd` / `Command` / `Meta`
 * all match; modifier order doesn't matter; the key is whichever part isn't
 * a modifier.
 *
 *   "CmdOrCtrl+B"      → "cmdorctrl+b"
 *   "Ctrl+Shift+K"     → "ctrl+shift+k"
 *   "Shift+Ctrl+K"     → "ctrl+shift+k"
 *   "B+Cmd"            → "cmd+b"
 *   "Command+B"        → "cmd+b"
 */

const MODIFIER_ALIASES: Record<string, string> = {
	cmd: "cmd",
	command: "cmd",
	meta: "cmd",
	super: "cmd",
	ctrl: "ctrl",
	control: "ctrl",
	cmdorctrl: "cmdorctrl",
	commandorcontrol: "cmdorctrl",
	// `Mod` is the doc-24-canonical cross-platform alias (⌘ on macOS,
	// Ctrl elsewhere). Apps SHOULD declare manifest shortcuts using `Mod`
	// per §App layer; normalizing it
	// to `cmdorctrl` here is what makes the install-time shell-collision
	// check correctly catch `Mod+Shift+P` colliding with shell's
	// `CmdOrCtrl+Shift+P`.
	mod: "cmdorctrl",
	alt: "alt",
	option: "alt",
	shift: "shift",
};

export function normalizeChord(chord: string): string {
	const parts = chord
		.split("+")
		.map((p) => p.trim())
		.filter(Boolean);
	if (parts.length === 0) return "";

	const mods: string[] = [];
	const keys: string[] = [];
	for (const part of parts) {
		const lower = part.toLowerCase();
		const canonical = MODIFIER_ALIASES[lower];
		if (canonical) {
			mods.push(canonical);
		} else {
			keys.push(lower);
		}
	}
	mods.sort();
	if (keys.length === 0 && mods.length > 0) {
		const promoted = mods.pop() ?? "";
		keys.push(promoted);
	}
	const uniqueMods: string[] = [];
	for (const m of mods) {
		if (!uniqueMods.includes(m)) uniqueMods.push(m);
	}
	return [...uniqueMods, ...keys].join("+");
}
