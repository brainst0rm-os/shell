/**
 * Which ARIA state attribute a composite stamps on its active item.
 *
 *  - `AriaSelected` (default): `aria-selected` — correct for `listbox`/`option`,
 *    `tablist`/`tab`, `grid`/`gridcell`. The shape every current adopter uses.
 *  - `AriaChecked`: `aria-checked` — for `radiogroup`/`radio`, where the active
 *    item is "checked", not "selected".
 *  - `None`: no selection-state attribute — for a `toolbar`, whose items are
 *    plain buttons with no selected/checked state (the roving focus is the only
 *    "current item" signal).
 *
 * Enum, not a bare string union, per the no-string-discriminator convention.
 */
export enum SelectionAttribute {
	AriaSelected = "aria-selected",
	AriaChecked = "aria-checked",
	None = "none",
}
