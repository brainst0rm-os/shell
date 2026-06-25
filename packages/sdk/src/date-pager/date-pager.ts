/**
 * Date pager — the shared "today + prev + next" cluster.
 *
 * Three apps shipped the same three buttons (today / prev / next) with
 * their own classes + their own per-app icon enums: Calendar header,
 * Database calendar-view toolbar, Journal day-strip. Per the rule
 * `[[feedback_extract_to_sdk_at_copy_two]]`, the second copy goes into the
 * SDK; the third is debt. This is the third copy — the cluster lifts here
 * so the keyboard/RTL/icon-direction story is wired once.
 *
 * Layout: `[Today] [‹] [›]` left-to-right (inline-axis flipped in RTL via
 * `IconDirection.Inline` on the carets so the visual order follows the
 * locale). Buttons share the BEM-style `.bs-date-pager__*` hooks so each
 * host can re-skin the chrome (Calendar gives the Today button a pill;
 * Database keeps it flat; Journal puts a month label after it). The host
 * supplies the labels (i18n is the host's job) — no string lives here.
 */

import { createIconElement } from "../icon/create-icon-element";
import { IconDirection, IconName } from "../icon/icon-registry";

export type DatePagerLabels = {
	/** Text on the "today" button (e.g. `"Today"`). */
	today: string;
	/** aria-label on the prev arrow (e.g. `"Previous"`). */
	prev: string;
	/** aria-label on the next arrow (e.g. `"Next"`). */
	next: string;
};

export type DatePagerOptions = {
	labels: DatePagerLabels;
	onToday(): void;
	onPrev(): void;
	onNext(): void;
	/** Optional extra class on the root cluster — host apps put their own
	 *  legacy class here to keep existing CSS attachments working without
	 *  touching every selector. */
	className?: string;
	/** Icon size in px. 16 matches the surrounding 20px line-height (per the
	 *  even-pixel line-height convention — `[[feedback_font_sizes_use_tokens]]`). */
	iconSize?: number;
};

export type DatePagerHandle = {
	readonly root: HTMLElement;
	readonly today: HTMLButtonElement;
	readonly prev: HTMLButtonElement;
	readonly next: HTMLButtonElement;
};

export function createDatePager(options: DatePagerOptions): DatePagerHandle {
	const root = document.createElement("div");
	root.className = options.className ? `bs-date-pager ${options.className}` : "bs-date-pager";

	const today = document.createElement("button");
	today.type = "button";
	today.className = "bs-date-pager__today";
	today.textContent = options.labels.today;
	today.addEventListener("click", options.onToday);

	const prev = makeArrowButton(
		"bs-date-pager__arrow bs-date-pager__arrow--prev",
		IconName.CaretLeft,
		options.labels.prev,
		options.iconSize ?? 16,
		options.onPrev,
	);

	const next = makeArrowButton(
		"bs-date-pager__arrow bs-date-pager__arrow--next",
		IconName.CaretRight,
		options.labels.next,
		options.iconSize ?? 16,
		options.onNext,
	);

	root.append(today, prev, next);

	return { root, today, prev, next };
}

function makeArrowButton(
	className: string,
	icon: IconName,
	label: string,
	iconSize: number,
	onClick: () => void,
): HTMLButtonElement {
	const btn = document.createElement("button");
	btn.type = "button";
	btn.className = className;
	btn.setAttribute("aria-label", label);
	btn.title = label;
	btn.appendChild(
		createIconElement(icon, {
			size: iconSize,
			direction: IconDirection.Inline,
		}),
	);
	btn.addEventListener("click", onClick);
	return btn;
}
