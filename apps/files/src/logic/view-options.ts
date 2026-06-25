/**
 * Per-folder view-options persistence (9.8.11): view mode + sort + group-by,
 * remembered per folder with a vault-wide default the "Apply to all folders"
 * affordance writes. Renderer-local `localStorage` (the same posture as the
 * sidebar-open pref) — view chrome is per-device, not synced entity content;
 * entity-backed `Folder/v1.view`/`sortBy` persistence is the cross-device
 * follow-up the schema already reserves.
 *
 * Storage shape (one JSON blob, versioned key):
 *   { "default"?: ViewOptions, "folders": { [folderId]: ViewOptions } }
 *
 * Every read re-validates with the enum guards, so a corrupted blob or a
 * value from a build with different enums degrades to "no stored options"
 * rather than poisoning the store's state.
 */

import {
	DEFAULT_TILE_SIZE,
	DEFAULT_VIEW_MODE,
	type TileSize,
	type ViewMode,
	isSupportedViewMode,
	isTileSize,
} from "../view-mode";
import { DEFAULT_GROUP_KEY, type GroupKey, isGroupKey } from "./group";
import { DEFAULT_LIST_COLUMNS, type ListColumn, parseListColumns } from "./list-columns";
import { DEFAULT_SORT_DIRECTION, DEFAULT_SORT_KEY, SortDirection, SortKey } from "./sort";

export type ViewOptions = {
	mode: ViewMode;
	sortKey: SortKey;
	sortDirection: SortDirection;
	groupKey: GroupKey;
	/** Grid / Gallery tile-size preset (9.8.11). */
	tileSize: TileSize;
	/** List-mode trailing columns, in render order (9.8.11). */
	columns: readonly ListColumn[];
};

export const DEFAULT_VIEW_OPTIONS: ViewOptions = Object.freeze({
	mode: DEFAULT_VIEW_MODE,
	sortKey: DEFAULT_SORT_KEY,
	sortDirection: DEFAULT_SORT_DIRECTION,
	groupKey: DEFAULT_GROUP_KEY,
	tileSize: DEFAULT_TILE_SIZE,
	columns: DEFAULT_LIST_COLUMNS,
});

const STORE_KEY = "brainstorm.files.viewOptions.v1";

/** The localStorage key for one vault. The app-origin `localStorage` is
 *  shared across every vault opened in this app (same origin) and
 *  `ROOT_FOLDER_ID` is a fixed constant, so an unscoped key let vault B's
 *  root inherit vault A's root options. A per-vault discriminator
 *  (`vaultKey`, derived from the root folder's per-vault `createdAt`)
 *  isolates the blob. A missing key (no snapshot resolved yet, older shell)
 *  degrades to the legacy unscoped key so an existing blob keeps working. */
function storeKeyFor(vaultKey?: string): string {
	return vaultKey ? `${STORE_KEY}:${vaultKey}` : STORE_KEY;
}

type StoredBlob = {
	default?: ViewOptions;
	folders: Record<string, ViewOptions>;
};

function isSortKey(value: unknown): value is SortKey {
	return (Object.values(SortKey) as unknown[]).includes(value);
}

function isSortDirection(value: unknown): value is SortDirection {
	return value === SortDirection.Asc || value === SortDirection.Desc;
}

function parseOptions(raw: unknown): ViewOptions | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Record<string, unknown>;
	if (!isSupportedViewMode(r.mode)) return null;
	if (!isSortKey(r.sortKey)) return null;
	if (!isSortDirection(r.sortDirection)) return null;
	if (!isGroupKey(r.groupKey)) return null;
	// Fields added after the first ship parse LENIENTLY (default when
	// missing/invalid) so an older stored blob keeps its remembered options.
	return {
		mode: r.mode,
		sortKey: r.sortKey,
		sortDirection: r.sortDirection,
		groupKey: r.groupKey,
		tileSize: isTileSize(r.tileSize) ? r.tileSize : DEFAULT_TILE_SIZE,
		columns: r.columns === undefined ? DEFAULT_LIST_COLUMNS : parseListColumns(r.columns),
	};
}

function readBlob(vaultKey?: string): StoredBlob {
	try {
		const raw = globalThis.localStorage?.getItem(storeKeyFor(vaultKey));
		if (!raw) return { folders: {} };
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") return { folders: {} };
		const blob = parsed as Record<string, unknown>;
		const folders: Record<string, ViewOptions> = {};
		if (blob.folders && typeof blob.folders === "object") {
			for (const [id, value] of Object.entries(blob.folders as Record<string, unknown>)) {
				const options = parseOptions(value);
				if (options) folders[id] = options;
			}
		}
		const fallback = parseOptions(blob.default);
		return fallback ? { default: fallback, folders } : { folders };
	} catch {
		return { folders: {} };
	}
}

function writeBlob(blob: StoredBlob, vaultKey?: string): void {
	try {
		globalThis.localStorage?.setItem(storeKeyFor(vaultKey), JSON.stringify(blob));
	} catch {
		// Quota / disabled — options revert to defaults on reload; the live
		// session keeps working off React state.
	}
}

/** The options to apply when entering `folderId`: its own remembered set,
 *  else the vault-wide default, else the built-in defaults. Scoped to
 *  `vaultKey` so the shared-origin blob never bleeds across vaults
 *  (root-folder ids collide otherwise). */
export function readViewOptions(folderId: string, vaultKey?: string): ViewOptions {
	const blob = readBlob(vaultKey);
	return blob.folders[folderId] ?? blob.default ?? DEFAULT_VIEW_OPTIONS;
}

/** Remember `options` for one folder, within `vaultKey`'s blob. */
export function writeViewOptions(folderId: string, options: ViewOptions, vaultKey?: string): void {
	const blob = readBlob(vaultKey);
	blob.folders[folderId] = options;
	writeBlob(blob, vaultKey);
}

/** "Apply to all folders": make `options` the vault-wide default AND drop
 *  every per-folder override so the change is actually visible everywhere
 *  (keeping overrides would silently defeat the affordance). */
export function applyViewOptionsToAllFolders(options: ViewOptions, vaultKey?: string): void {
	writeBlob({ default: options, folders: {} }, vaultKey);
}
