/**
 * `isEditableElement` — true when focus on `el` should suppress single-key
 * shortcut delivery (the shell-renderer 6.10e cross-layer policy, ported
 * verbatim so apps' `attachShortcut` and the shell's `useShortcut` agree).
 *
 * Single-key chords (no modifier, e.g. `T`, `?`, `/`, `Escape`) skip when
 * focus is in an editable element so the user can type the character;
 * modifier chords (`CmdOrCtrl+F`, `Ctrl+Shift+K`) always pass through.
 *
 * Tolerates `null`, non-Element targets (Window/Document) — returns false.
 */

/** `<input>` types that accept text. Other input types (`button`,
 *  `checkbox`, `submit`, `range`, etc.) are non-textual and don't
 *  suppress single-key chords. Lowercased; the comparator normalises. */
const TEXT_INPUT_TYPES = new Set<string>([
	"text",
	"search",
	"email",
	"url",
	"tel",
	"password",
	"number",
	"date",
	"datetime-local",
	"month",
	"time",
	"week",
]);

export function isEditableElement(el: EventTarget | Element | null | undefined): boolean {
	if (!el) return false;
	if (!(el instanceof Element)) return false;
	const tag = el.tagName;
	if (tag === "TEXTAREA") return true;
	if (tag === "INPUT") {
		const type = ((el as HTMLInputElement).type ?? "text").toLowerCase();
		return TEXT_INPUT_TYPES.has(type);
	}
	if ("isContentEditable" in el && (el as HTMLElement).isContentEditable) return true;
	let cursor: Element | null = el;
	while (cursor) {
		const attr = cursor.getAttribute?.("contenteditable");
		if (attr !== null && attr !== undefined) {
			const normalised = attr.toLowerCase();
			if (normalised === "" || normalised === "true" || normalised === "plaintext-only") {
				return true;
			}
			if (normalised === "false") return false;
		}
		cursor = cursor.parentElement;
	}
	return false;
}
