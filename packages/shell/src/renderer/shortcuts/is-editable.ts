/**
 * `isEditableElement` — true when focus on `el` should suppress single-key
 * shortcut delivery (Stage 6.10e per [24-keyboard-shortcuts.md §Cross-layer suppression](../../../../../docs/shell/24-keyboard-shortcuts.md)).
 *
 * Cross-layer policy:
 *   - **Single-key chords** (no modifier, e.g. `?`, `/`, `Escape`) are
 *     **renderer-side only** — the main-process `before-input-event`
 *     matcher refuses to deliver them at all, since main can't observe
 *     renderer focus.
 *   - In the renderer, `useShortcut` skips dispatch for a single-key
 *     chord when `event.target` (or `document.activeElement`) is one of:
 *       * `<input>` with a text-like type
 *       * `<textarea>`
 *       * `[contenteditable]` (true/empty/"plaintext-only")
 *   - **Modifier chords** (`Cmd+?`, `Ctrl+Shift+K`, etc.) always pass
 *     through — they're intentional gestures the user wants to invoke
 *     even when typing.
 *
 * The check tolerates `null` (no focus / detached node) → returns false
 * so the chord fires. It also tolerates non-HTMLElement targets (Window,
 * Document) gracefully — same result.
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
		// HTMLInputElement.type defaults to "text"; explicit `type=""` also
		// resolves to "text". The HTMLElement API normalises unknown
		// `type` values to "text" too.
		const type = ((el as HTMLInputElement).type ?? "text").toLowerCase();
		return TEXT_INPUT_TYPES.has(type);
	}
	// contenteditable: spec values are "", "true", "false", "plaintext-only".
	// `isContentEditable` is the authoritative computed view in real
	// browsers (handles inherited contenteditable from ancestors), but
	// jsdom doesn't implement it. Walk the ancestor chain checking the
	// raw attribute so tests + production agree.
	if ("isContentEditable" in el && (el as HTMLElement).isContentEditable) return true;
	let cursor: Element | null = el;
	while (cursor) {
		const attr = cursor.getAttribute?.("contenteditable");
		if (attr !== null && attr !== undefined) {
			const normalised = attr.toLowerCase();
			if (normalised === "" || normalised === "true" || normalised === "plaintext-only") {
				return true;
			}
			if (normalised === "false") return false; // explicit opt-out wins
		}
		cursor = cursor.parentElement;
	}
	return false;
}
