/**
 * `useCellOptionsKeyboard` — the shared keyboard contract for a property-cell
 * value picker (KBN-G-roles, 12.4). Both the link cell and the tag cell render
 * the same combobox shape — a search `<input>` over a filtered list of options
 * — so the ARIA + arrow-key plumbing lives here once instead of being spelled
 * by hand in each (which is how the raw `role="listbox"`/`role="option"`
 * literals crept in).
 *
 * Wraps `useCompositeKeyboard` in `CompositeHost.Combobox`: the input keeps
 * Space / Home / End / Backspace for text editing; ↑/↓ move the cursor through
 * the options via `aria-activedescendant` (no per-option focus churn) and Enter
 * activates the cursor row. The list + option roles are stamped by the hook, so
 * the cell markup carries no composite-role literal. `aria-selected` reflects
 * membership (the checkmark), conveyed by `multiselectable` + `selectedIndices`.
 */

import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEffect, useState } from "react";
import { CompositeHost, Orientation, useCompositeKeyboard } from "../../a11y";
import type { CompositeItemProps } from "../../a11y/use-composite-keyboard";

export type CellOptionsInputProps = {
	role: "combobox";
	"aria-expanded": boolean;
	"aria-activedescendant": string | undefined;
	onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
};

export type CellOptionsKeyboard = {
	/** Spread onto the picker's search `<input>`. */
	inputProps: CellOptionsInputProps;
	/** Role + orientation for the options container (was `role="listbox"`). */
	listRole: string;
	listOrientation: "horizontal" | "vertical" | undefined;
	listMultiselectable: boolean | undefined;
	/** Spread onto each option element (was hand-written `role="option"` +
	 *  `aria-selected`); supplies the id, role, tabIndex, `data-composite-index`
	 *  and membership `aria-selected`. */
	getOptionProps: (index: number) => CompositeItemProps;
	/** The keyboard-cursor index, for an optional active-row visual. */
	activeIndex: number;
};

export function useCellOptionsKeyboard(opts: {
	count: number;
	multi: boolean;
	/** Indices of the currently-selected options (membership → checkmark). */
	selectedIndices: ReadonlySet<number>;
	/** Activate (toggle) the option at `index` — Enter, or the row's click. */
	onActivate: (index: number) => void;
}): CellOptionsKeyboard {
	const [activeIndex, setActiveIndex] = useState(0);

	// The filtered list grew/shrank (the query changed) — keep the cursor in
	// range rather than stranded past the new end.
	useEffect(() => {
		if (activeIndex >= opts.count) setActiveIndex(0);
	}, [opts.count, activeIndex]);

	const { containerProps, getItemProps } = useCompositeKeyboard({
		orientation: Orientation.Vertical,
		count: opts.count,
		activeIndex,
		onActiveIndexChange: setActiveIndex,
		onActivate: opts.onActivate,
		useAriaActiveDescendant: true,
		host: CompositeHost.Combobox,
		wrap: false,
		multiselectable: opts.multi,
		selectedIndices: opts.selectedIndices,
	});

	return {
		inputProps: {
			role: "combobox",
			"aria-expanded": opts.count > 0,
			"aria-activedescendant": containerProps["aria-activedescendant"],
			onKeyDown: containerProps.onKeyDown,
		},
		listRole: containerProps.role,
		listOrientation: containerProps["aria-orientation"],
		listMultiselectable: containerProps["aria-multiselectable"],
		getOptionProps: getItemProps,
		activeIndex,
	};
}
