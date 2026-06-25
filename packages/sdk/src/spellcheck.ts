/**
 * Spellcheck opt-in for text surfaces (B11.16b). The shell enables Chromium's
 * spellchecker on every app renderer session (B11.16a), but Chromium only checks
 * elements whose `spellcheck` attribute is on. This makes that choice explicit
 * and shared so no app hand-rolls the attribute: prose surfaces (Notes/Journal
 * body, property text cells, sticky notes, Mailbox compose) opt in; code /
 * monospace / structured inputs opt out. See editing/60-spellcheck.md.
 */

/** Whether a text surface holds natural-language prose or code/structured text. */
export enum TextSurfaceKind {
	Prose = "prose",
	Code = "code",
}

/** The `spellcheck` attribute value for a surface — `true` for prose, `false`
 *  for code. Use as the JSX `spellCheck={…}` prop or the DOM `el.spellcheck`. */
export function spellcheckForSurface(kind: TextSurfaceKind): boolean {
	return kind === TextSurfaceKind.Prose;
}
