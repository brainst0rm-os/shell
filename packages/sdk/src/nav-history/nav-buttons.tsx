/**
 * `<NavButtons>` — the shared, identical-everywhere back/forward control
 * that lives in every app header (the React twin; `createNavButtons` is the
 * vanilla-DOM one). Two icon buttons in a `role="group"`, disabled-state
 * driven live off the `NavHistory` controller, and — by default — the
 * shared chords + mouse thumb buttons bound for you so a host gets the
 * whole behaviour with one element. Chrome (`.header-nav*`) is owned by the
 * shell-injected app-theme so it looks the same in all 11 apps.
 */

import { useEffect, useRef, useSyncExternalStore } from "react";
import { DEFAULT_NAV_LABELS, type NavLabels } from "../i18n/common-labels";
import { Icon, IconDirection, IconName } from "../icon";
import type { NavHistory } from "./nav-history";
import { attachNavShortcuts } from "./shortcuts";

export type NavButtonsProps<L> = {
	history: NavHistory<L>;
	/** Apply a location the user stepped to. MUST NOT itself call
	 *  `history.push` (that would corrupt the stack) — set app state only. */
	onNavigate: (loc: L) => void;
	labels?: Partial<NavLabels>;
	/** Bind the shared chords + mouse back/forward on `window`. Default
	 *  true — opt out if the host owns its own keyboard wiring. */
	bindShortcuts?: boolean;
	className?: string;
};

/** Subscribe a component to a `NavHistory` so disabled state stays live. */
function useNav<L>(history: NavHistory<L>): {
	canGoBack: boolean;
	canGoForward: boolean;
} {
	const snap = useSyncExternalStore(
		(cb) => history.subscribe(cb),
		() => history.get(),
		() => history.get(),
	);
	return {
		canGoBack: snap.back.length > 0,
		canGoForward: snap.forward.length > 0,
	};
}

export function NavButtons<L>({
	history,
	onNavigate,
	labels,
	bindShortcuts = true,
	className,
}: NavButtonsProps<L>) {
	const merged: NavLabels = { ...DEFAULT_NAV_LABELS, ...labels };
	const { canGoBack, canGoForward } = useNav(history);

	const goBack = (): void => {
		const loc = history.back();
		if (loc !== null) onNavigate(loc);
	};
	const goForward = (): void => {
		const loc = history.forward();
		if (loc !== null) onNavigate(loc);
	};

	const goBackRef = useRef(goBack);
	const goForwardRef = useRef(goForward);
	goBackRef.current = goBack;
	goForwardRef.current = goForward;

	// The React twin reuses the exact same binder as the DOM twin
	// (`attachNavShortcuts`) — one source for the chord/mouse contract,
	// no parallel keydown handler to drift.
	useEffect(() => {
		if (!bindShortcuts) return;
		return attachNavShortcuts(
			window,
			() => goBackRef.current(),
			() => goForwardRef.current(),
		);
	}, [bindShortcuts]);

	return (
		<div
			className={className ? `header-nav ${className}` : "header-nav"}
			role="group"
			aria-label={merged.region}
		>
			<button
				type="button"
				className="header-nav__btn"
				data-testid="nav-back"
				aria-label={merged.back}
				data-bs-tooltip={merged.back}
				title={canGoBack ? undefined : merged.back}
				disabled={!canGoBack}
				onClick={goBack}
			>
				<Icon name={IconName.CaretLeft} size={15} direction={IconDirection.Inline} />
			</button>
			<button
				type="button"
				className="header-nav__btn"
				data-testid="nav-forward"
				aria-label={merged.forward}
				data-bs-tooltip={merged.forward}
				title={canGoForward ? undefined : merged.forward}
				disabled={!canGoForward}
				onClick={goForward}
			>
				<Icon name={IconName.CaretRight} size={15} direction={IconDirection.Inline} />
			</button>
		</div>
	);
}
