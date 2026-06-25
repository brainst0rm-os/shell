/**
 * `createNavButtons` — the vanilla-DOM twin of `<NavButtons>`. Plain-DOM
 * apps (Database / Graph / Calendar / Tasks / Journal / Code Editor /
 * Bookmarks / Whiteboard) drop the SAME back/forward control into their
 * `.app-header__left` without pulling React, mirroring how
 * `createIconElement` twins `<Icon>`. Same markup, same `.header-nav*`
 * classes (owned by the shell app-theme), same disabled-state behaviour,
 * same chords + mouse buttons bound by default.
 */

import { DEFAULT_NAV_LABELS, type NavLabels } from "../i18n/common-labels";
import { createIconElement } from "../icon/create-icon-element";
import { IconDirection, IconName } from "../icon/icon-registry";
import type { NavHistory } from "./nav-history";
import { type NavShortcutTarget, attachNavShortcuts } from "./shortcuts";

export type CreateNavButtonsOptions<L> = {
	history: NavHistory<L>;
	/** Apply a stepped-to location. MUST NOT call `history.push`. */
	onNavigate: (loc: L) => void;
	labels?: Partial<NavLabels>;
	/** Bind shared chords + mouse back/forward. Default `window`; pass
	 *  `false` to skip (host owns its keyboard wiring). */
	shortcuts?: NavShortcutTarget | false;
	className?: string;
};

export type NavButtonsHandle = {
	element: HTMLElement;
	destroy(): void;
};

export function createNavButtons<L>(opts: CreateNavButtonsOptions<L>): NavButtonsHandle {
	const labels: NavLabels = { ...DEFAULT_NAV_LABELS, ...opts.labels };
	const { history, onNavigate } = opts;

	const group = document.createElement("div");
	group.className = opts.className ? `header-nav ${opts.className}` : "header-nav";
	group.setAttribute("role", "group");
	group.setAttribute("aria-label", labels.region);

	const mkBtn = (icon: IconName, label: string, testid: string): HTMLButtonElement => {
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "header-nav__btn";
		btn.dataset.testid = testid;
		btn.setAttribute("aria-label", label);
		// Animated `.bs-tooltip` chip via `data-bs-tooltip`; native `title` is
		// added by `sync()` only while the button is disabled (no pointer
		// events fire on a disabled control, so the chip can't open).
		btn.dataset.bsTooltip = label;
		btn.appendChild(createIconElement(icon, { size: 15, direction: IconDirection.Inline }));
		return btn;
	};

	const backBtn = mkBtn(IconName.CaretLeft, labels.back, "nav-back");
	const forwardBtn = mkBtn(IconName.CaretRight, labels.forward, "nav-forward");

	const goBack = (): void => {
		const loc = history.back();
		if (loc !== null) onNavigate(loc);
	};
	const goForward = (): void => {
		const loc = history.forward();
		if (loc !== null) onNavigate(loc);
	};
	backBtn.addEventListener("click", goBack);
	forwardBtn.addEventListener("click", goForward);

	group.appendChild(backBtn);
	group.appendChild(forwardBtn);

	const syncTitle = (btn: HTMLButtonElement): void => {
		const label = btn.getAttribute("aria-label");
		if (btn.disabled && label) btn.title = label;
		else btn.removeAttribute("title");
	};
	const sync = (): void => {
		backBtn.disabled = !history.canGoBack();
		forwardBtn.disabled = !history.canGoForward();
		syncTitle(backBtn);
		syncTitle(forwardBtn);
	};
	sync();
	const unsubscribe = history.subscribe(sync);

	const target = opts.shortcuts === undefined ? window : opts.shortcuts;
	const detachKeys = target === false ? null : attachNavShortcuts(target, goBack, goForward);

	return {
		element: group,
		destroy(): void {
			unsubscribe();
			detachKeys?.();
			backBtn.removeEventListener("click", goBack);
			forwardBtn.removeEventListener("click", goForward);
			group.remove();
		},
	};
}
