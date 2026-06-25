/**
 * CellPopover — the anchored-panel primitive every editing cell opens.
 * Positioning + dismiss live in the shared `useAnchoredPanel` hook
 * (also used by the add-property menu); this only owns the inline
 * trigger button and panel chrome.
 */

import {
	type JSX,
	type KeyboardEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { type PanelAnchor, useAnchoredPanel } from "../use-anchored-panel";
import { usePropertyUiSeams } from "../use-properties";

const PANEL_WIDTH = 260;
const PANEL_GUTTER = 6;
const PANEL_MAX_HEIGHT = 320;

type Anchor = PanelAnchor;

export type CellPopoverProps = {
	/** Rendered as the inline trigger contents (the cell's resting view). */
	trigger: ReactNode;
	triggerClassName: string;
	triggerAriaLabel: string;
	disabled?: boolean | undefined;
	/**
	 * Set when `trigger` itself contains interactive controls (e.g. a tag
	 * chip's remove button). A `<button>` cannot legally nest another button
	 * — it raises a hydration error and breaks click semantics — so the
	 * trigger renders as a focusable `role="button"` div instead, leaving the
	 * nested controls as real buttons that `stopPropagation`.
	 */
	triggerHasInteractiveContent?: boolean | undefined;
	/** Panel body. Receives a `close()` it can call on commit. */
	children: (close: () => void) => ReactNode;
	panelAriaLabel: string;
	panelClassName?: string | undefined;
	/** Keyboard "begin editing" signal from the host (the grid's Enter-to-edit,
	 *  12.4) — opens the popover on a rising edge, the popover-cell analogue of
	 *  the inline cells' `autoEdit`. A disabled trigger ignores it. */
	autoOpen?: boolean | undefined;
	/** Acked once an `autoOpen` rising edge has been consumed, so the host can
	 *  clear the intent (a re-press re-opens). */
	onAutoOpenHandled?: (() => void) | undefined;
};

export function CellPopover({
	trigger,
	triggerClassName,
	triggerAriaLabel,
	disabled,
	triggerHasInteractiveContent,
	children,
	panelAriaLabel,
	panelClassName,
	autoOpen,
	onAutoOpenHandled,
}: CellPopoverProps): JSX.Element {
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLElement | null>(null);
	const setTriggerRef = useCallback((el: HTMLElement | null) => {
		triggerRef.current = el;
	}, []);
	const [anchor, setAnchor] = useState<Anchor | null>(null);
	const panelId = useId();

	const onOpen = useCallback((): boolean => {
		if (disabled) return false;
		const rect = triggerRef.current?.getBoundingClientRect();
		if (!rect) return false;
		setAnchor({ top: rect.top, left: rect.left, bottom: rect.bottom });
		setOpen(true);
		return true;
	}, [disabled]);

	// Keyboard Enter-to-edit (12.4): open the popover when the host raises
	// `autoOpen`, then ack so the latch clears — but only once the popover
	// actually opened (a trigger whose rect hasn't resolved doesn't open, so
	// acking there would swallow the Enter with no editor).
	useEffect(() => {
		if (!autoOpen || disabled) return;
		if (onOpen()) onAutoOpenHandled?.();
	}, [autoOpen, disabled, onOpen, onAutoOpenHandled]);

	const onKeyDown = useCallback(
		(e: KeyboardEvent<HTMLElement>) => {
			// Only the trigger div itself opens on Enter/Space — a key bubbling up
			// from a nested control (e.g. a tag chip's ✕ remove button) must run
			// its own action, not the popover. The nested buttons stopPropagation
			// on click but not on keydown, so guard on the event origin here.
			if (e.target !== e.currentTarget) return;
			// Enter/Space activates this focusable trigger (the native
			// button-activation pattern); the registry suppresses single keys, so
			// activation has to read the key locally here.
			// keyboard-exempt
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				onOpen();
			}
		},
		[onOpen],
	);

	const close = useCallback(() => setOpen(false), []);

	return (
		<>
			{triggerHasInteractiveContent ? (
				<div
					ref={setTriggerRef}
					role="button"
					tabIndex={disabled ? -1 : 0}
					className={triggerClassName}
					onClick={onOpen}
					onKeyDown={disabled ? undefined : onKeyDown}
					aria-disabled={disabled || undefined}
					aria-haspopup="dialog"
					aria-expanded={open}
					aria-controls={open ? panelId : undefined}
					aria-label={triggerAriaLabel}
				>
					{trigger}
				</div>
			) : (
				<button
					ref={setTriggerRef}
					type="button"
					className={triggerClassName}
					onClick={onOpen}
					disabled={disabled}
					aria-haspopup="dialog"
					aria-expanded={open}
					aria-controls={open ? panelId : undefined}
					aria-label={triggerAriaLabel}
				>
					{trigger}
				</button>
			)}
			{open && anchor ? (
				<CellPopoverPanel
					id={panelId}
					anchor={anchor}
					ariaLabel={panelAriaLabel}
					className={panelClassName}
					onClose={close}
				>
					{children(close)}
				</CellPopoverPanel>
			) : null}
		</>
	);
}

function CellPopoverPanel({
	id,
	anchor,
	ariaLabel,
	className,
	onClose,
	children,
}: {
	id: string;
	anchor: Anchor;
	ariaLabel: string;
	className?: string | undefined;
	onClose: () => void;
	children: ReactNode;
}): JSX.Element {
	const ref = useRef<HTMLDivElement | null>(null);
	const { escapeMatcher } = usePropertyUiSeams();
	const style = useAnchoredPanel({
		anchor,
		width: PANEL_WIDTH,
		maxHeight: PANEL_MAX_HEIGHT,
		gutter: PANEL_GUTTER,
		ref,
		onDismiss: onClose,
		escapeMatcher,
	});

	const panel = (
		<div
			ref={ref}
			id={id}
			className={className ? `bs-cell-pop ${className}` : "bs-cell-pop"}
			role="dialog"
			aria-label={ariaLabel}
			style={{
				top: `${style.top}px`,
				left: `${style.left}px`,
				width: `${PANEL_WIDTH}px`,
				maxHeight: `${PANEL_MAX_HEIGHT}px`,
			}}
		>
			{children}
		</div>
	);

	// Portal to <body> so the panel's `position: fixed` resolves against the
	// viewport and its `z-index` competes at the root layer. Rendered in place,
	// a transformed/contained ancestor (the virtualized grid's stacking context)
	// both traps the z-index — so the Database Details inspector (z-index 100)
	// paints over it and swallows clicks (F-018) — and re-bases `fixed` to that
	// ancestor, mispositioning the panel. Same "transient layers escape to top"
	// rule the fancy menus already follow.
	return typeof document === "undefined" ? panel : createPortal(panel, document.body);
}
