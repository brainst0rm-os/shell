/**
 * Imperative twin of `<CountBadge>` — same class, same `data-count`, same
 * cap rule. For the few imperative-DOM call sites (canvas-app chrome,
 * board-lane builders) that aren't React yet.
 */

import { CountBadgeTone, countBadgeClassName, formatCount } from "./format-count";

export interface CreateCountBadgeOptions {
	tone?: CountBadgeTone;
	max?: number;
	className?: string;
}

/** Build a `.bs-count-badge` `<span>` for `count`. */
export function createCountBadge(
	count: number,
	options: CreateCountBadgeOptions = {},
): HTMLSpanElement {
	const span = document.createElement("span");
	span.className = countBadgeClassName(options.tone ?? CountBadgeTone.Neutral, options.className);
	span.dataset.count = String(count);
	span.textContent = formatCount(count, options.max);
	return span;
}
