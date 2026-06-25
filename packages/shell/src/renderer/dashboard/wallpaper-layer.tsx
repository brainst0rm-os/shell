/**
 * The dashboard wallpaper layer. Two smoothness guarantees on vault entry
 * (cold start, vault switch, and re-entry after an auto-lock unlock):
 *
 *   1. `usePersistedWallpaper` paints the last-seen wallpaper instantly from a
 *      synchronous localStorage read, so the fallback gradient never flashes in
 *      the tick before the `dashboard:snapshot` IPC resolves.
 *   2. For image wallpapers the full-resolution `<img>` fades in only once it has
 *      decoded, over its 320px thumbnail painted as an instant blur-up underlay
 *      — never a blank frame, never a hard pop.
 *
 * Successive wallpapers cross-fade via `AnimatePresence` keyed on kind+value.
 */

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import type { DashboardWallpaper, DashboardWallpaperKind } from "../../preload";
import {
	FALLBACK_WALLPAPER,
	resolveWallpaperImageSrc,
	wallpaperBackground,
	wallpaperThumbUrl,
} from "./wallpaper";

export const WALLPAPER_CACHE_KEY = "brainstorm.dashboard.wallpaper";
const WALLPAPER_KINDS: readonly DashboardWallpaperKind[] = ["image", "gradient", "solid"];

export function readCachedWallpaper(): DashboardWallpaper | null {
	try {
		const raw = window.localStorage.getItem(WALLPAPER_CACHE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<DashboardWallpaper>;
		if (
			parsed &&
			typeof parsed.value === "string" &&
			WALLPAPER_KINDS.includes(parsed.kind as DashboardWallpaperKind)
		) {
			return { kind: parsed.kind as DashboardWallpaperKind, value: parsed.value };
		}
	} catch {
		// localStorage unavailable or malformed cache — fall back.
	}
	return null;
}

export function writeCachedWallpaper(wallpaper: DashboardWallpaper): void {
	try {
		window.localStorage.setItem(WALLPAPER_CACHE_KEY, JSON.stringify(wallpaper));
	} catch {
		// best-effort cache; ignore quota / availability errors.
	}
}

/**
 * Paints the last-seen wallpaper instantly on mount (read synchronously from
 * localStorage) so re-entering a vault never flashes the fallback before the
 * snapshot IPC resolves. The live snapshot wallpaper takes over — and refreshes
 * the cache — within a tick.
 */
export function usePersistedWallpaper(current: DashboardWallpaper | undefined): DashboardWallpaper {
	const [cached, setCached] = useState<DashboardWallpaper | null>(() => readCachedWallpaper());
	useEffect(() => {
		if (!current) return;
		writeCachedWallpaper(current);
		setCached(current);
	}, [current]);
	return current ?? cached ?? FALLBACK_WALLPAPER;
}

export function WallpaperLayer({ wallpaper }: { wallpaper: DashboardWallpaper }) {
	return (
		<AnimatePresence initial={false}>
			<WallpaperFrame key={`${wallpaper.kind}::${wallpaper.value}`} wallpaper={wallpaper} />
		</AnimatePresence>
	);
}

function WallpaperFrame({ wallpaper }: { wallpaper: DashboardWallpaper }) {
	const isImage = wallpaper.kind === "image";
	const thumb = isImage ? wallpaperThumbUrl(wallpaper) : null;
	const imgRef = useRef<HTMLImageElement | null>(null);
	const [imageReady, setImageReady] = useState(false);

	// A browser-cached image (the documented vault re-entry / post-unlock case)
	// can already be `complete` before React attaches the `onLoad` listener, so
	// the event never fires and the full-res layer would stay stuck at
	// opacity:0. Reconcile against the live `complete` flag on mount.
	useEffect(() => {
		if (imgRef.current?.complete) setImageReady(true);
	}, []);

	// Base layer paints instantly: the CSS background for solid/gradient, or the
	// thumbnail blur-up underlay for an image while the full-res file decodes.
	const baseStyle = isImage
		? thumb
			? { backgroundImage: `url("${thumb}")` }
			: {}
		: { background: wallpaperBackground(wallpaper) };

	return (
		<motion.div
			className="dashboard__wallpaper"
			aria-hidden="true"
			// Solid + gradient kinds paint via CSS background. For images we render
			// an <img> child instead — the compositor scales the element bitmap
			// during macOS Live Resize, which is dramatically smoother than
			// re-rasterizing `background-size: cover` every frame.
			style={baseStyle}
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			exit={{ opacity: 0 }}
			transition={{ duration: 0.4, ease: "easeInOut" }}
		>
			{isImage && (
				<img
					ref={imgRef}
					className="dashboard__wallpaper-image"
					data-ready={imageReady ? "true" : "false"}
					src={resolveWallpaperImageSrc(wallpaper.value)}
					alt=""
					draggable={false}
					onLoad={() => setImageReady(true)}
					onError={() => setImageReady(true)}
				/>
			)}
		</motion.div>
	);
}
