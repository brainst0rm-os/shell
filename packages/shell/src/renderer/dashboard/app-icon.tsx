/**
 * AppIcon — the squircle artwork used everywhere a dashboard icon shows.
 * Pure rendering: parent owns positioning, hover/drag behaviour, and the
 * caller decides whether to wrap it in a button. Resolves the visual in
 * three steps:
 *   1. If a `src` is provided, render the asset filling the squircle.
 *   2. If the asset fails to load (404 or decode error), fall back to (3).
 *   3. Render initials on a deterministic gradient derived from `seed`.
 *
 * The fallback path is the same code that runs when callers explicitly
 * pass `src={null}`, so apps without a manifest icon always look right.
 */

import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { type IconGradient, gradientFor, initialsFor } from "./app-icon-palette";
import { SQUIRCLE_RADIUS_PERCENT } from "./squircle";

export type AppIconProps = {
	/** Display name — used to derive initials when there's no asset. */
	name: string;
	/** Stable seed for the gradient — the app id, not the label. */
	seed: string;
	/** Resolved icon URL (e.g. `brainstorm://app-icon/<appId>`) or `null`. */
	src?: string | null;
	/** Pixel size of the icon's outer box. Default 64 — matches grid math. */
	size?: number;
	/** When true, reserve the dot slot under the icon so the layout doesn't
	 *  shift between idle and running states. The dashboard wants this; lists
	 *  / pickers / settings rows don't — those should geometrically centre
	 *  the tile next to their text. Default false. */
	withRunningIndicator?: boolean;
	/** When `withRunningIndicator` is true, light the dot. No-op otherwise. */
	running?: boolean;
	/** Render just the brand glyph (the transparent icon asset) with no
	 *  squircle tile / glass / sheen / shadow — for tight chrome like the
	 *  widget header, where the full tile reads as visual noise. The asset is
	 *  already a centred glyph; this drops the surface around it. Falls back to
	 *  bare initials (no gradient tile) when there's no asset. */
	glyph?: boolean;
};

export function AppIcon({
	name,
	seed,
	src,
	size = 64,
	withRunningIndicator = false,
	running = false,
	glyph = false,
}: AppIconProps) {
	const palette = useMemo<IconGradient>(() => gradientFor(seed), [seed]);
	const initials = useMemo(() => initialsFor(name), [name]);
	const [imageOk, setImageOk] = useState<boolean>(Boolean(src));

	useEffect(() => {
		setImageOk(Boolean(src));
	}, [src]);

	const showImage = Boolean(src) && imageOk;

	if (glyph) {
		return (
			<span className="app-icon-glyph" aria-hidden="true" style={{ width: size, height: size }}>
				{showImage ? (
					<img
						className="app-icon-glyph__image"
						src={src ?? ""}
						alt=""
						draggable={false}
						onError={() => setImageOk(false)}
					/>
				) : (
					<span className="app-icon-glyph__initials" style={{ fontSize: size * 0.55 }}>
						{initials}
					</span>
				)}
			</span>
		);
	}

	const tileStyle: CSSProperties = {
		width: size,
		height: size,
		borderRadius: SQUIRCLE_RADIUS_PERCENT,
		// With an icon asset the glyph SVG is transparent, so the tile surface
		// is the shared `.glass--strong` frosted pane (theme-following: a light
		// frost on a light theme, dark on dark, the wallpaper blurred through
		// it) and we leave `background` unset here. Without an asset the base is
		// the deterministic per-seed gradient the initials sit on, which
		// overrides the glass background.
		...(showImage
			? {}
			: { background: `linear-gradient(165deg, ${palette.from} 0%, ${palette.to} 100%)` }),
		color: palette.ink,
	};

	return (
		<span className="app-icon" aria-hidden="true">
			<span className="app-icon__tile glass--strong" style={tileStyle}>
				{showImage ? (
					<img
						className="app-icon__image"
						src={src ?? ""}
						alt=""
						draggable={false}
						onError={() => setImageOk(false)}
					/>
				) : (
					// Only the fallback path renders initials. The glyph SVG is
					// transparent, so a persistent initials layer would bleed
					// through around the glyph.
					<span className="app-icon__initials" style={{ fontSize: size * 0.36 }}>
						{initials}
					</span>
				)}
			</span>
			{withRunningIndicator && (
				<span
					className={running ? "app-icon__dot app-icon__dot--on" : "app-icon__dot"}
					aria-hidden="true"
				/>
			)}
		</span>
	);
}
