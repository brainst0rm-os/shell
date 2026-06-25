/**
 * 9.20.6 keystone — the ordered previewable-sibling list Files hands
 * Preview on `intent.open` / `intent.quick-look`.
 *
 * OQ-PV-3 is resolved in favour of *Files passes the list*: Preview
 * never re-queries the folder, so it can't (and shouldn't) reconstruct
 * the user's current sort + filter + search. The contract is therefore
 * that this list is already in **the exact order the user sees in the
 * Files content view** — `buildPreviewSiblings` is fed
 * `currentVisibleRows()` (sorted/filtered/searched) and only preserves
 * that order, never re-sorts.
 *
 * Pure + DOM-free so the filter/order behaviour is unit-tested without
 * the renderer. The shape mirrors the Preview app's
 * `PreviewContextSibling` wire type; bytes-mode sources never cross the
 * bridge (only a defined URL survives structured-clone through the
 * preload), so a row with no `url` is dropped.
 */

export interface PreviewSiblingRow {
	id: string;
	/** Entity type id — only `fileType` rows can be previewed. */
	type: string;
	name: string;
	/** MIME from the file's `mime` property, or `null` when unknown. */
	mime: string | null;
	sizeBytes: number | null;
	modifiedAt: number | null;
	/** `attachment` URL; `null` for a bytes-only / urless row. */
	url: string | null;
}

export interface PreviewSibling {
	id: string;
	name: string;
	mime: string;
	sizeBytes: number | null;
	modifiedAt: number | null;
	url: string;
}

/** Mirror of the Preview app's `previewKindFor` rule set, trimmed to a
 *  yes/no. Kept here (not imported) so the Files bundle takes no
 *  cross-sandbox dependency on Preview's logic surface — the two move
 *  together by convention, covered by this module's tests. */
export function isPreviewableMime(mime: string | null | undefined): boolean {
	const m = (mime ?? "").toLowerCase().split(";")[0]?.trim() ?? "";
	if (!m) return false;
	if (m === "application/pdf") return true;
	return (
		m.startsWith("image/") ||
		m.startsWith("video/") ||
		m.startsWith("audio/") ||
		m.startsWith("text/")
	);
}

/**
 * Filter `rows` (already in the user's visible order) to the previewable
 * file siblings, **preserving that order**. A row is kept iff it is the
 * file type, carries a previewable MIME, and has a URL that survives the
 * bridge. The cursor anchoring is Preview's job (it locates the opened
 * `entityId` by id), so this never reorders to float the anchor.
 */
export function buildPreviewSiblings(
	rows: readonly PreviewSiblingRow[],
	fileType: string,
): PreviewSibling[] {
	const out: PreviewSibling[] = [];
	for (const row of rows) {
		if (row.type !== fileType) continue;
		if (!isPreviewableMime(row.mime)) continue;
		if (!row.url) continue;
		out.push({
			id: row.id,
			name: row.name,
			mime: row.mime as string,
			sizeBytes: row.sizeBytes,
			modifiedAt: row.modifiedAt,
			url: row.url,
		});
	}
	return out;
}
