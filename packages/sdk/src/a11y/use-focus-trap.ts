/**
 * `useFocusTrap` — the React/DOM binding for the pure `createFocusTrapStack`
 * model. Wraps Tab/Shift+Tab inside the container so focus can't leak out,
 * pushes the entry onto a module-scope stack so the Escape stack (KBN-2) can
 * pop topmost-first, and restores focus to the opener on unmount or disable.
 *
 * StrictMode-safe: the push returns an unsubscribe specific to the entry id,
 * so a double-mount cleanly pops the first entry when the second mounts. The
 * effect captures `document.activeElement` at enable-time as the restore
 * target if the caller didn't pass one.
 */

import type { RefObject } from "react";
import { useCallback, useEffect, useId, useMemo, useRef } from "react";
import { getEscapeStack } from "./escape-stack";
import type { FocusTrapStack } from "./focus-trap";

export enum InitialFocusMode {
	FirstFocusable = "first-focusable",
	Container = "container",
	Explicit = "explicit",
}

export type UseFocusTrapOptions = {
	enabled: boolean;
	restoreFocusTo?: HTMLElement | null;
	onEscape?: () => void;
	initialFocus?: InitialFocusMode;
	/**
	 * Target for `InitialFocusMode.Explicit`. Accepts either a live element or a
	 * `RefObject` — the ref is resolved inside the mount effect (after React has
	 * attached refs), so a call site can point at a child it renders without the
	 * first-render `null` timing trap. Used by `<Popover initialFocusRef>` to land
	 * a security/confirm dialog's focus on its SAFE default (e.g. Deny).
	 */
	explicitInitialFocus?: HTMLElement | RefObject<HTMLElement | null> | null;
	openerLabel?: string;
};

export type UseFocusTrapResult = {
	containerProps: {
		ref: React.RefCallback<HTMLElement>;
		tabIndex: -1;
		onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
	};
};

const FOCUSABLE_SELECTOR = [
	"a[href]",
	"area[href]",
	"button:not([disabled])",
	"input:not([disabled]):not([type='hidden'])",
	"select:not([disabled])",
	"textarea:not([disabled])",
	"iframe",
	"audio[controls]",
	"video[controls]",
	"[contenteditable]:not([contenteditable='false'])",
	"[tabindex]:not([tabindex='-1'])",
].join(",");

// The trap shares the renderer-wide escape stack from `getEscapeStack()`
// (KBN-2) so a focus-trapped dialog opened from inside a popover unwinds in
// the right order under one document-level Escape handler.
const sharedStack: FocusTrapStack = getEscapeStack();

export function _getFocusTrapStackForTests(): FocusTrapStack {
	return sharedStack;
}

function isVisible(el: HTMLElement): boolean {
	// happy-dom + jsdom don't fully implement getComputedStyle visibility, but
	// the cases that matter (display:none / hidden attr / inert) are still
	// catchable. offsetParent is a fast proxy for "in the rendered tree".
	if (el.hasAttribute("hidden")) return false;
	if (el.getAttribute("aria-hidden") === "true") return false;
	if ((el as HTMLElement & { inert?: boolean }).inert === true) return false;
	return true;
}

function focusables(container: HTMLElement): HTMLElement[] {
	const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
	return nodes.filter(isVisible);
}

export function useFocusTrap(options: UseFocusTrapOptions): UseFocusTrapResult {
	const containerRef = useRef<HTMLElement | null>(null);
	const id = useId();
	const onEscapeRef = useRef<(() => void) | undefined>(options.onEscape);
	const initialFocus = options.initialFocus ?? InitialFocusMode.FirstFocusable;
	const explicitInitialFocus = options.explicitInitialFocus ?? null;
	const restoreFocusTo = options.restoreFocusTo;
	const enabled = options.enabled;
	const openerLabel = options.openerLabel;

	// Keep the callback ref current without re-running the effect — the trap
	// entry's onEscape closes over `onEscapeRef.current`, so the latest
	// version is always invoked.
	useEffect(() => {
		onEscapeRef.current = options.onEscape;
	}, [options.onEscape]);

	const setContainer = useCallback<React.RefCallback<HTMLElement>>((node) => {
		containerRef.current = node;
	}, []);

	useEffect(() => {
		if (!enabled) return;
		const container = containerRef.current;
		if (container === null) return;
		// Capture the opener BEFORE we move focus — `document.activeElement` is
		// about to change.
		const capturedOpener =
			restoreFocusTo !== undefined ? restoreFocusTo : (document.activeElement as HTMLElement | null);
		const offEntry = sharedStack.push({
			id,
			...(openerLabel !== undefined ? { openerLabel } : {}),
			onEscape: () => onEscapeRef.current?.(),
		});

		// Move initial focus.
		const focusFirst = () => {
			const list = focusables(container);
			// Resolve a ref target at effect time (refs are attached by now); a bare
			// element passes through unchanged.
			const explicitEl =
				explicitInitialFocus !== null &&
				explicitInitialFocus !== undefined &&
				"current" in explicitInitialFocus
					? explicitInitialFocus.current
					: (explicitInitialFocus ?? null);
			const target =
				initialFocus === InitialFocusMode.Explicit && explicitEl !== null
					? explicitEl
					: initialFocus === InitialFocusMode.Container
						? container
						: (list[0] ?? container);
			target.focus();
		};
		focusFirst();

		return () => {
			offEntry();
			// Restore on unmount / disable. Guard against the opener having been
			// removed from the DOM in the meantime (route changes do this).
			if (capturedOpener !== null && document.body.contains(capturedOpener)) {
				capturedOpener.focus();
			}
		};
	}, [enabled, id, initialFocus, explicitInitialFocus, openerLabel, restoreFocusTo]);

	const onKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLElement>) => {
			if (!enabled) return;
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				onEscapeRef.current?.();
				return;
			}
			if (e.key !== "Tab") return;
			const container = containerRef.current;
			if (container === null) return;
			const list = focusables(container);
			if (list.length === 0) {
				e.preventDefault();
				container.focus();
				return;
			}
			const first = list[0] as HTMLElement;
			const last = list[list.length - 1] as HTMLElement;
			const active = document.activeElement as HTMLElement | null;
			if (e.shiftKey) {
				if (active === first || active === container || !container.contains(active)) {
					e.preventDefault();
					last.focus();
				}
				return;
			}
			if (active === last) {
				e.preventDefault();
				first.focus();
			}
		},
		[enabled],
	);

	const containerProps = useMemo<UseFocusTrapResult["containerProps"]>(
		() => ({
			ref: setContainer,
			tabIndex: -1,
			onKeyDown,
		}),
		[setContainer, onKeyDown],
	);
	return { containerProps };
}
