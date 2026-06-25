/**
 * View-mode enum per docs/apps/41-file-manager-ux.md §View modes.
 *
 * v1 ships four content layouts: list / icon-list / grid / gallery. Column
 * (Finder miller-columns) stays deferred to v2 per OQ-174 — it interacts
 * with intra-app tabs + the nav-stack and we want both to mature first; the
 * enum lists it up-front so feature gates read uniformly (`mode ===
 * ViewMode.Column` is a single named symbol everywhere) but the renderer +
 * the supported-modes set ignore it.
 *
 * `IconList` is a one-lane vertical list with a larger leading icon — the
 * Finder "as Icons in a list" density between the compact List and the
 * tiled Grid. It shares List's row machinery (group headers, columns,
 * single-lane virtualisation) and only scales the glyph + row height.
 *
 * Per docs/foundations/35-code-conventions.md §Enums, every kind / mode /
 * status string lives behind a named symbol. Raw `case "list":` is rejected.
 */

export enum ViewMode {
	List = "list",
	IconList = "icon-list",
	Grid = "grid",
	Gallery = "gallery",
	Column = "column",
}

export const DEFAULT_VIEW_MODE: ViewMode = ViewMode.List;

/** The v1-supported subset, in picker order. Keep separate from the enum so
 *  a future addition (Column) doesn't surface in the picker without UX work. */
export const SUPPORTED_VIEW_MODES: readonly ViewMode[] = [
	ViewMode.List,
	ViewMode.IconList,
	ViewMode.Grid,
	ViewMode.Gallery,
];

export function isSupportedViewMode(value: unknown): value is ViewMode {
	return typeof value === "string" && (SUPPORTED_VIEW_MODES as readonly string[]).includes(value);
}

/** A one-lane vertical layout (List / IconList) — distinguished from the
 *  lane-based tile grid (Grid / Gallery). Group-by section headers, the
 *  column chooser and single-lane virtualisation are list-mode features
 *  shared by both. */
export function isListMode(mode: ViewMode): boolean {
	return mode === ViewMode.List || mode === ViewMode.IconList;
}

/** Grid / Gallery tile-size presets (9.8.11). Geometry scales in
 *  `content-list.tsx`; persisted per folder with the other view options. */
export enum TileSize {
	Small = "small",
	Medium = "medium",
	Large = "large",
}

export const DEFAULT_TILE_SIZE: TileSize = TileSize.Medium;

export const TILE_SIZES: readonly TileSize[] = [TileSize.Small, TileSize.Medium, TileSize.Large];

export function isTileSize(value: unknown): value is TileSize {
	return typeof value === "string" && (TILE_SIZES as readonly string[]).includes(value);
}
