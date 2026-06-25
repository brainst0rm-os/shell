/**
 * Composite-keyboard host kind — what element owns the keydown listener.
 *
 *  - `Listbox` (default): the focused container *is* the list. Space activates
 *    the active item, Home/End/Page keys jump within the list. This is the
 *    sidebar / menu / option-group shape.
 *  - `Combobox`: the focused element is a **text input** that controls a
 *    separate listbox via `aria-activedescendant`. Bare printable keys
 *    (including Space) and Home/End/Page keys must fall through to the input
 *    for text editing — only the orientation arrows + Enter drive the list.
 *
 * Enum, not a bare string union, per the no-string-discriminator convention.
 */
export enum CompositeHost {
	Listbox = "listbox",
	Combobox = "combobox",
}
