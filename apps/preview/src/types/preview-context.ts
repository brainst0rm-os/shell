/**
 * `PreviewContext` — describes where a Preview session was opened FROM,
 * so the slideshow + filmstrip can mirror that source rather than always
 * walking the global demo list.
 *
 * Apple Quick Look anchors the navigation model: when invoked on an
 * image attached to a note, the arrow keys walk every attachment IN
 * THAT NOTE. When invoked on a folder file, they walk every previewable
 * sibling IN THAT FOLDER. The originating app supplies the context via
 * the `intent.open` / `intent.quick-look` payload — the preview app is
 * agnostic about how it was sourced.
 *
 * The full entity wiring lands at 9.20.6 (Files passes real handles via
 * `intent.open`). Today's preview drop accepts the context shape but
 * resolves siblings from whatever the originator inlines into the
 * payload; this keeps the wire format frozen so renderers / chrome /
 * filmstrip don't have to change again.
 */

export enum PreviewContextKind {
	/** Opened from inside a note — siblings are that note's media. */
	Note = "note",
	/** Opened from a folder in Files — siblings are previewable
	 *  entities in that folder. */
	Folder = "folder",
	/** Opened from a multi-item selection (e.g. Cmd-clicked rows in
	 *  Files, or a Database row range) — siblings are exactly the
	 *  selection. */
	Selection = "selection",
	/** Opened with no surrounding gallery (a stray double-click on a
	 *  loose file). The filmstrip hides; arrow nav is a no-op. */
	Single = "single",
}

export type PreviewContext = {
	readonly kind: PreviewContextKind;
	/** Stable identifier for the source (note id / folder id / etc.).
	 *  Omitted for `Single`. Lets the preview app skip a re-apply when
	 *  the same intent fires twice. */
	readonly sourceId?: string;
	/** Human-readable label rendered in the toolbar chip
	 *  ("Coastal trip notes", "Screenshots"). Falls back to a generic
	 *  per-kind string when the originator omits it. */
	readonly label?: string;
};
