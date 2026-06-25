/**
 * Change detection for the live bookmark list (the `equals` of the app's
 * `createVaultListStore`). `listAll()` returns fresh objects every call, so
 * identity is useless; instead each bookmark collapses to a version
 * fingerprint — the store-level `rev` (the entities service bumps it on
 * EVERY write, including a foreign editor like the Database grid) plus the
 * domain `updatedAt` (covers the kv/demo paths where `rev` is absent).
 *
 * Order-independent (id → version map), mirroring the shared
 * `vaultSnapshotEquals`. Without this, every coarse vault change — any
 * app's write — re-rendered the whole Bookmarks DOM: the tag board lost
 * its horizontal scroll, and a rebuild landing mid-drag destroyed the
 * drag source (Chromium cancels the drag), so card drops "did nothing".
 */

import type { Bookmark } from "../types/bookmark";

function version(b: Bookmark): string {
	return `${b.rev ?? ""}:${b.updatedAt}`;
}

export function bookmarkListEquals(a: readonly Bookmark[], b: readonly Bookmark[]): boolean {
	if (a === b) return true;
	if (a.length !== b.length) return false;
	const seen = new Map<string, string>();
	for (const x of a) seen.set(x.id, version(x));
	for (const x of b) {
		if (seen.get(x.id) !== version(x)) return false;
	}
	return true;
}
