/**
 * React twin of `createPanelToggleButton` — same DOM, same class, same
 * aria contract. Notes + Files render through this so their toggles are
 * bit-identical with the plain-DOM apps' toggles.
 */

import { PanelToggleIcon } from "./PanelToggleIcon";
import { PanelSide } from "./panel-toggle-icon";

export interface PanelToggleButtonProps {
	side: PanelSide;
	open: boolean;
	onClick: () => void;
	/** Localized labels for the open vs closed states. */
	labels: { show: string; hide: string };
	/** Optional `aria-controls` target id. */
	controls?: string;
	disabled?: boolean;
	/** Overrides the title / aria-label — used to explain a disabled state
	 *  (e.g. "Select a contact first"). Falls back to the show/hide label. */
	hint?: string;
	/** Optional `data-testid`. */
	testId?: string;
}

export function PanelToggleButton({
	side,
	open,
	onClick,
	labels,
	controls,
	disabled,
	hint,
	testId,
}: PanelToggleButtonProps) {
	const label = hint ?? (open ? labels.hide : labels.show);
	return (
		<button
			type="button"
			className="bs-panel-toggle"
			onClick={onClick}
			aria-pressed={open}
			aria-label={label}
			data-bs-tooltip={label}
			title={disabled ? label : undefined}
			aria-controls={controls}
			disabled={disabled}
			data-testid={testId}
		>
			<PanelToggleIcon side={side} active={open} />
		</button>
	);
}

export { PanelSide };
