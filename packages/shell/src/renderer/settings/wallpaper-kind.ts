/**
 * Discriminator for the `DashboardWallpaper` value. Lives in its own file so
 * Vite's React Fast Refresh keeps working when `wallpaper-section.tsx`
 * changes — non-component exports next to components break Fast Refresh
 * (`Could not Fast Refresh ("WallpaperKind" export is incompatible)`).
 *
 * The string values are the wire format the main process's `DashboardStore`
 * accepts, so the enum identity here is interchangeable with the literal
 * union declared on the main side until that one is also enum-migrated.
 */
export enum WallpaperKind {
	Solid = "solid",
	Gradient = "gradient",
	Image = "image",
}
