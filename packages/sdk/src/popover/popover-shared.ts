/**
 * Shared popover contract — the size / body-padding enums (exact same
 * names + values as the shell `ui/popover.tsx` so the call-site contract
 * is identical) and the one centralised Escape-matcher seam.
 *
 * Both the React `<Popover>` and the DOM `createPopoverElement` route
 * Escape through `DEFAULT_POPOVER_ESCAPE_MATCHER` (a bare-Escape test) or
 * an injected matcher — no raw inline `e.key` is scattered across the
 * module. A host with its own chord registry passes its predicate; a host
 * that owns Escape itself passes `null` to opt out.
 */

export enum PopoverSize {
	Small = "small",
	Medium = "medium",
	Large = "large",
}

export enum PopoverBodyPadding {
	Compact = "compact",
	Comfortable = "comfortable",
}

/** Predicate over a KeyboardEvent: "is this the cancel chord?". `null`
 *  opts the popover out of self-handling Escape entirely. */
export type PopoverEscapeMatcher = (event: KeyboardEvent) => boolean;

export const DEFAULT_POPOVER_ESCAPE_MATCHER: PopoverEscapeMatcher = (event) =>
	event.key === "Escape";
