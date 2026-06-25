/**
 * Pure adapters for the library sidebar: turn the vault's `File/v1` rows into
 * the renderable `PreviewFile[]` the host already knows how to mount, sorted
 * most-recent-first, and a case-insensitive name filter for the search input.
 *
 * Kept DOM-free + framework-free so the mapping/sort/filter branches are
 * unit-tested without a renderer or a live bridge — the same discipline as
 * [[entity-to-file]], which this reuses for the per-row resolution.
 */

import type { PreviewFile } from "../demo/dataset";
import { type ResolvableEntity, entityToPreviewFile } from "./entity-to-file";

/** The Files-app entity type whose rows back the sidebar. Mirrors
 *  `FILE_TYPE` in `apps/files` — Preview can't import across app packages, so
 *  the wire string is duplicated (a rename is caught by the manifest opener
 *  list, which enumerates the same MIME surface). */
export const FILE_ENTITY_TYPE = "brainstorm/File/v1";

/** A queried row: the resolvable shape plus the entity's top-level
 *  `updatedAt` — the authoritative recency key (a `File/v1` row carries it on
 *  the envelope, not necessarily in `properties`). */
export type FileEntityRow = ResolvableEntity & { updatedAt?: number | null };

/**
 * Resolve previewable files from queried `File/v1` rows, newest first. A row
 * Preview can't render (`entityToPreviewFile` → `null`: no MIME or no
 * bridge-safe URL) is dropped, so every sidebar entry opens cleanly rather
 * than landing on the "no preview" pane. Recency uses the envelope
 * `updatedAt`, falling back to the file's own `modifiedAt` then 0.
 */
export function previewFilesFromEntities(rows: ReadonlyArray<FileEntityRow>): PreviewFile[] {
	const resolved: { file: PreviewFile; ts: number }[] = [];
	for (const row of rows) {
		const file = entityToPreviewFile(row);
		if (!file) continue;
		const ts = row.updatedAt ?? file.info.modifiedAt ?? 0;
		resolved.push({ file, ts });
	}
	resolved.sort((a, b) => b.ts - a.ts);
	return resolved.map((r) => r.file);
}

/**
 * Filter an already-sorted file list by a free-text query, matched
 * case-insensitively against the filename. A blank query returns the input
 * unchanged (same identity — no needless re-render). Order is preserved.
 */
export function filterPreviewFiles(
	files: ReadonlyArray<PreviewFile>,
	query: string,
): ReadonlyArray<PreviewFile> {
	const needle = query.trim().toLowerCase();
	if (!needle) return files;
	return files.filter((f) => f.info.name.toLowerCase().includes(needle));
}
