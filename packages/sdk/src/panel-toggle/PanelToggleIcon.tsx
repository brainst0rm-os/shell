/**
 * React twin of `panelToggleIcon` — same SVG geometry, JSX shape. Used by
 * the React-rendered apps (Notes, Files) so their headers stay
 * bit-identical with the plain-DOM apps' headers.
 */

import { PanelSide } from "./panel-toggle-icon";

export type PanelToggleIconProps = {
	side: PanelSide;
	active?: boolean;
	size?: number;
};

const DEFAULT_SIZE = 14;

export function PanelToggleIcon({
	side,
	active = false,
	size = DEFAULT_SIZE,
}: PanelToggleIconProps) {
	const dividerX = side === PanelSide.Left ? 6 : 10;
	const fillX = side === PanelSide.Left ? 2 : 10.5;
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
			<line x1={dividerX} y1="2.5" x2={dividerX} y2="13.5" />
			{active && <rect x={fillX} y="3" width="3.5" height="10" rx="0.5" fill="currentColor" />}
		</svg>
	);
}
