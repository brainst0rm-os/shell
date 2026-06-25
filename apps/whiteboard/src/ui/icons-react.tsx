/**
 * React glyph component for the Whiteboard header / toolbar — the React twin
 * of `createIcon` (`icons.ts`). Renders the same stroke-only `currentColor`
 * paths inline as JSX so header buttons stay in the React tree (9.17.21).
 * Shares the single `WHITEBOARD_ICON_PATHS` source with the imperative twin.
 */

import type { ReactElement } from "react";
import { WHITEBOARD_ICON_PATHS, type WhiteboardIcon } from "./icons";

export function WbIcon({
	glyph,
	size = 16,
	className,
}: {
	glyph: WhiteboardIcon;
	size?: number;
	className?: string;
}): ReactElement {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.5}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			{WHITEBOARD_ICON_PATHS[glyph].map((d) => (
				<path key={d} d={d} />
			))}
		</svg>
	);
}
