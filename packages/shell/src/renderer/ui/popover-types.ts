/**
 * `<Popover>` value/type surface, split from `./popover` so the component
 * module exports only the component (Fast Refresh requires component files to
 * export nothing else). Import these from `@renderer/ui/popover-types`.
 */

import type { ReactNode, RefObject } from "react";

export enum PopoverSize {
	Small = "small",
	Medium = "medium",
	Large = "large",
}

/**
 * Body padding density. `Compact` (space-2) suits list / grid bodies where
 * inner items already carry their own hit-target padding; `Comfortable`
 * (space-4) suits prose-style bodies (e.g. confirm dialogs) where the text
 * itself needs breathing room from the panel edges.
 */
export enum PopoverBodyPadding {
	Compact = "compact",
	Comfortable = "comfortable",
}

export type PopoverProps = {
	title: ReactNode;
	onClose: () => void;
	children: ReactNode;
	/** Optional action row pinned to the bottom (e.g. Cancel / Confirm). */
	footer?: ReactNode;
	size?: PopoverSize;
	bodyPadding?: PopoverBodyPadding;
	/**
	 * Land initial focus on a specific control inside the panel instead of the
	 * first focusable (the header ✕). Pass a ref to the SAFE default action of a
	 * security / destructive-confirm dialog (e.g. Deny / Cancel) so the keyboard
	 * default fails safe. Default (unset) keeps first-focusable behaviour.
	 */
	initialFocusRef?: RefObject<HTMLElement | null>;
	/**
	 * Let the panel shrink to its content height instead of holding the size
	 * variant's `min-height`. Use for short, content-fit dialogs (confirms,
	 * single-field credential editors) where the fixed minimum leaves a dead
	 * gap between the body and the footer. The size variant's `max-height` still
	 * caps it, so overflowing bodies scroll as before.
	 */
	fitContent?: boolean;
	/** Test hook for the panel root. */
	testId?: string;
};
