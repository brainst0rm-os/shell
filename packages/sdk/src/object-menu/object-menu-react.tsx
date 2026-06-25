/**
 * `<ObjectMenuTrigger>` — the React twin of `attachObjectMenuTrigger`, for
 * React apps (Notes) that want the shared object menu inside their own
 * tree rather than wiring the imperative DOM helper. Same contract: wraps
 * its children with a right-click (`contextmenu`) opener AND renders the
 * visible ⋯ overflow button; the menu itself is the same shared anchored
 * popup (mounted into `document.body` by `openObjectMenu`), so there is
 * exactly one renderer — the React side is just the trigger surface.
 *
 * The host passes a `context()` callback resolved at open time (the menu
 * always reflects the current object). Returning `null` is a no-op.
 */

import {
	type KeyboardEvent as ReactKeyboardEvent,
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
} from "react";
import { matchesChord } from "../shortcut/chord";
import type { ObjectMenuContext } from "./object-menu-trigger";
import { closeObjectMenu, openObjectMenu } from "./open-object-menu";

const ACTIVATE_CHORD_ENTER = "Enter";
const ACTIVATE_CHORD_SPACE = "Space";
const MORE_BUTTON_GAP = 4;

/** Where the trigger lives — picks the right ⋯ affordance.
 *
 *  - `default` (omitted): inline trigger (header titles, card actions);
 *    the ⋯ is dim-visible by default and goes opaque on hover.
 *  - `row`: list-row trigger (sidebar items, table rows). The ⋯
 *    overlays the row's right edge without taking layout space, and is
 *    hidden until the row is hovered / keyboard-focused / the menu is
 *    open. See `bs-object-menu__host--row` in `object-menu.css`. */
export type ObjectMenuTriggerVariant = "default" | "row";

export type ObjectMenuTriggerProps = {
	/** Resolved at open time so the menu reflects the current object;
	 *  `null` → the trigger is inert. */
	context: () => ObjectMenuContext;
	/** `aria-label` / tooltip + the ⋯ button's accessible name. */
	moreActionsLabel: string;
	/** The row content the right-click opener wraps. */
	children: ReactNode;
	className?: string;
	/** Picks the ⋯ affordance. Defaults to `default` (inline / always
	 *  dim-visible). Pass `"row"` on every list-row trigger so the ⋯ is
	 *  hidden until the row is hovered / focused / the menu is open. */
	variant?: ObjectMenuTriggerVariant;
	/** When true, suppress the visible ⋯ button — the wrapper still
	 *  arms right-click on its children, but the affordance lives
	 *  elsewhere (e.g. a standalone `<ObjectMenuMoreButton>` on the
	 *  opposite side of an app header). */
	noMoreButton?: boolean;
};

export function ObjectMenuTrigger({
	context,
	moreActionsLabel,
	children,
	className,
	variant = "default",
	noMoreButton = false,
}: ObjectMenuTriggerProps) {
	const moreRef = useRef<HTMLButtonElement>(null);

	useEffect(() => closeObjectMenu, []);

	const onContextMenu = useCallback(
		(event: ReactMouseEvent) => {
			const ctx = context();
			if (!ctx) return;
			event.preventDefault();
			void openObjectMenu({ x: event.clientX, y: event.clientY }, ctx);
		},
		[context],
	);

	const openFromButton = useCallback(() => {
		const ctx = context();
		const el = moreRef.current;
		if (!ctx || !el) return;
		const r = el.getBoundingClientRect();
		void openObjectMenu({ x: r.left, y: r.bottom + MORE_BUTTON_GAP }, { ...ctx, anchor: el });
	}, [context]);

	const onMoreClick = useCallback(
		(event: ReactMouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
			openFromButton();
		},
		[openFromButton],
	);

	const onMoreKey = useCallback(
		(event: ReactKeyboardEvent) => {
			if (event.defaultPrevented) return;
			if (
				matchesChord(event.nativeEvent, ACTIVATE_CHORD_ENTER) ||
				matchesChord(event.nativeEvent, ACTIVATE_CHORD_SPACE)
			) {
				event.preventDefault();
				openFromButton();
			}
		},
		[openFromButton],
	);

	const hostClass = [
		"bs-object-menu__host",
		variant === "row" ? "bs-object-menu__host--row" : null,
		className ?? null,
	]
		.filter((c): c is string => c !== null)
		.join(" ");

	return (
		<div className={hostClass} onContextMenu={onContextMenu}>
			{children}
			{noMoreButton ? null : (
				<button
					ref={moreRef}
					type="button"
					className="bs-object-menu__more"
					aria-haspopup="menu"
					aria-label={moreActionsLabel}
					data-bs-tooltip={moreActionsLabel}
					onClick={onMoreClick}
					onKeyDown={onMoreKey}
				>
					<span className="bs-object-menu__more-dot" />
					<span className="bs-object-menu__more-dot" />
					<span className="bs-object-menu__more-dot" />
				</button>
			)}
		</div>
	);
}

export type ObjectMenuMoreButtonProps = {
	/** Resolved at click time so the menu reflects the current object;
	 *  `null` → the button is inert. */
	context: () => ObjectMenuContext;
	/** `aria-label` / tooltip / accessible name. */
	moreActionsLabel: string;
	className?: string;
	/** Render the ⋯ unavailable — the affordance for a surface whose header
	 *  has no object and no app-level actions: the ⋯ is never absent, it just
	 *  can't open anything here. Uses `aria-disabled` (NOT the native
	 *  `disabled` attribute) so the button stays focusable + hoverable and its
	 *  tooltip still explains *why* it's dimmed (F-271 — a natively-disabled
	 *  button emits no hover/focus events, so the tooltip never showed). */
	disabled?: boolean;
	/** Tooltip shown while `disabled` — explains why there's nothing to open
	 *  (e.g. "Select an item to see its actions"). Falls back to
	 *  `moreActionsLabel` when omitted. */
	disabledReason?: string;
};

/** Standalone ⋯ button — same affordance as `<ObjectMenuTrigger>`'s inline
 *  button, usable on its own when the visible trigger needs to live apart
 *  from the right-click surface (e.g. the rightmost header chip while the
 *  title stays a context-menu wrapper). */
export function ObjectMenuMoreButton({
	context,
	moreActionsLabel,
	className,
	disabled = false,
	disabledReason,
}: ObjectMenuMoreButtonProps) {
	const buttonRef = useRef<HTMLButtonElement>(null);

	useEffect(() => closeObjectMenu, []);

	const open = useCallback(() => {
		if (disabled) return;
		const ctx = context();
		const el = buttonRef.current;
		if (!ctx || !el) return;
		const r = el.getBoundingClientRect();
		void openObjectMenu({ x: r.left, y: r.bottom + MORE_BUTTON_GAP }, { ...ctx, anchor: el });
	}, [context, disabled]);

	const onClick = useCallback(
		(event: ReactMouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
			open();
		},
		[open],
	);

	const onKeyDown = useCallback(
		(event: ReactKeyboardEvent) => {
			if (event.defaultPrevented) return;
			if (
				matchesChord(event.nativeEvent, ACTIVATE_CHORD_ENTER) ||
				matchesChord(event.nativeEvent, ACTIVATE_CHORD_SPACE)
			) {
				event.preventDefault();
				open();
			}
		},
		[open],
	);

	const btnClass = ["bs-object-menu__more", className ?? null]
		.filter((c): c is string => c !== null)
		.join(" ");

	return (
		<button
			ref={buttonRef}
			type="button"
			className={btnClass}
			aria-haspopup="menu"
			aria-label={moreActionsLabel}
			data-bs-tooltip={disabled ? (disabledReason ?? moreActionsLabel) : moreActionsLabel}
			aria-disabled={disabled ? "true" : undefined}
			onClick={onClick}
			onKeyDown={onKeyDown}
		>
			<span className="bs-object-menu__more-dot" />
			<span className="bs-object-menu__more-dot" />
			<span className="bs-object-menu__more-dot" />
		</button>
	);
}
