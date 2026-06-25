/**
 * Brainstorm brand mark — the product's app icon. Renders the shipped
 * raster artwork (`packages/shell/art/icon.png`, with an @2x variant for
 * retina), the same image used for the Electron window/tray icon, so the
 * brand reads identically everywhere. The PNG already bakes in the
 * squircle + bolt; consumers only size it.
 *
 * Used on the Welcome / vault-selection screen and anywhere else the
 * product needs to identify itself visually.
 */

import type { CSSProperties } from "react";
import "./brand-mark.css";

export type BrandMarkProps = {
	size?: number;
	className?: string;
	style?: CSSProperties;
};

export function BrandMark({ size = 64, className, style }: BrandMarkProps) {
	return (
		<span
			role="img"
			aria-label="Brainstorm"
			className={className ? `brand-mark ${className}` : "brand-mark"}
			style={{ width: size, height: size, ...style }}
		/>
	);
}
