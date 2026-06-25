/**
 * Pinnable shell surfaces (Stage 9.19.2 — `PinnedShellSurface`, a preset
 * built on the 7.13 pin mechanism). A shell surface is a privileged
 * shell overlay (the Bin today; Settings/Marketplace could follow) that
 * the user can pin to the dashboard like any object. Unlike an entity
 * pin it isn't vault data, so it resolves from this static registry
 * (mirrors how `app`/`view` tiles resolve renderer-side, not via the
 * entity pin-resolver).
 *
 * Pure: id ↔ {labelKey, icon}. The dashboard `IconRecord` persists only
 * `kind:"shell-surface"` + `target:<ShellSurfaceId>` (+ a label seed);
 * the tile's glyph + click target come from here.
 */

import { IconName } from "../ui/icon";

/** Discriminator for a pinned shell surface — enum, not a bare literal
 *  (no-string-discriminator convention). The value is the persisted
 *  `IconRecord.target`. */
export enum ShellSurfaceId {
	Bin = "bin",
}

export type ShellSurfaceMeta = {
	/** `t()` key for the tile label / pin affordance. */
	labelKey: string;
	/** Interface glyph painted on the tile. */
	icon: IconName;
};

export const SHELL_SURFACES: Record<ShellSurfaceId, ShellSurfaceMeta> = {
	[ShellSurfaceId.Bin]: { labelKey: "shell.bin.title", icon: IconName.Trash },
};

export function isShellSurfaceId(value: unknown): value is ShellSurfaceId {
	return typeof value === "string" && value in SHELL_SURFACES;
}

/** Stable, deterministic icon id for a pinned shell surface — distinct
 *  from the `pin_<entityId>` entity-pin namespace so the two can't
 *  collide, and idempotent (re-pin overwrites in place). */
export function shellSurfacePinIconId(id: ShellSurfaceId): string {
	return `pin_surface_${id}`;
}
