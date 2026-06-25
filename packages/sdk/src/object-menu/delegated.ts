/**
 * Delegated object-menu wiring — one `contextmenu` + one `click` listener on
 * a stable container, instead of per-row `attachObjectMenuTrigger`.
 *
 * Before: every rendered row attached its own `contextmenu` listener AND
 * built a 3-dot ⋯ button with two more listeners (O(N) listeners + O(N)
 * button DOM per render, and `render()` fires on every mutation). After:
 * rows just carry `data-entity-id` / `data-entity-type` + an inert ⋯ button;
 * the two delegated listeners resolve the target lazily via
 * `event.target.closest('[data-entity-id]')`. The menu itself is the shared
 * `openObjectMenu` — identical chrome everywhere.
 *
 * Extracted from Bookmarks / Journal / Tasks, which had byte-identical
 * copies. The container survives `replaceChildren` across re-renders, so the
 * binding is done exactly once; `getRuntime` / `resolve` / `labels` are read
 * lazily on every open so the single binding serves every render. A null
 * runtime (preview / standalone) makes the listeners early-return.
 */

import type { ObjectMenuChromeLabels } from "./menu-labels";
import type { ObjectMenuExtraItem, ObjectMenuRuntime } from "./object-menu";
import { closeObjectMenu, openObjectMenu } from "./open-object-menu";

export const ENTITY_ID_ATTR = "data-entity-id";
export const ENTITY_TYPE_ATTR = "data-entity-type";

const MORE_BUTTON_CLASS = "bs-object-menu__more";

/** Per-entity menu wiring resolved at open time from a row's data
 *  attributes. Returns null for an unknown / stale id (the menu then
 *  no-ops). `el` is the resolved `[data-entity-id]` element, for apps that
 *  need row context to decide the target. */
export type DelegatedMenuTarget = {
	entityType: string;
	label: string;
	extraItems?: ObjectMenuExtraItem[];
	onRemove?: () => void | Promise<void>;
};

export type DelegatedMenuResolver = (
	entityId: string,
	el: HTMLElement | null,
) => DelegatedMenuTarget | null;

export type CreateMoreButtonOptions = {
	/** Render the ⋯ unavailable — the affordance for a surface whose header has
	 *  no object and no app-level actions: the ⋯ is never absent, it just can't
	 *  open anything here. Uses `aria-disabled` (NOT the native `disabled`
	 *  attribute) so it stays hoverable and its tooltip explains *why* it's
	 *  dimmed (F-271 — a natively-disabled button emits no hover events, so the
	 *  tooltip never showed); the delegated click handler skips it. */
	disabled?: boolean;
	/** Tooltip shown while `disabled` — explains why there's nothing to open.
	 *  Falls back to the button label when omitted. */
	disabledReason?: string;
};

/** Build the inert ⋯ overflow button — pure markup, NO listeners (the
 *  delegated container click owns activation). Visual parity with the SDK
 *  trigger's button (same class + 3 dots). */
export function createMoreButton(
	label: string,
	options: CreateMoreButtonOptions = {},
): HTMLButtonElement {
	const button = document.createElement("button");
	button.type = "button";
	button.className = MORE_BUTTON_CLASS;
	button.setAttribute("aria-haspopup", "menu");
	button.setAttribute("aria-label", label);
	if (options.disabled) {
		// aria-disabled (not native `disabled`) keeps the button hoverable so the
		// tooltip explains *why* it's dimmed; the delegated click handler skips
		// any aria-disabled ⋯.
		button.setAttribute("aria-disabled", "true");
		button.dataset.bsTooltip = options.disabledReason ?? label;
	} else {
		button.dataset.bsTooltip = label;
	}
	for (let i = 0; i < 3; i++) {
		const dot = document.createElement("span");
		dot.className = "bs-object-menu__more-dot";
		button.appendChild(dot);
	}
	return button;
}

function resolveEntityElement(target: EventTarget | null): HTMLElement | null {
	return (target as HTMLElement | null)?.closest<HTMLElement>(`[${ENTITY_ID_ATTR}]`) ?? null;
}

/** Bind the two delegated listeners on `container` exactly once. */
export function bindDelegatedObjectMenu(
	container: HTMLElement,
	getRuntime: () => ObjectMenuRuntime,
	resolve: DelegatedMenuResolver,
	labels: () => Partial<ObjectMenuChromeLabels>,
): void {
	if (container.dataset.objectMenuBound === "true") return;
	container.dataset.objectMenuBound = "true";

	const openFor = (
		entityId: string,
		el: HTMLElement | null,
		point: { x: number; y: number },
		anchor?: HTMLElement,
	): void => {
		const runtime = getRuntime();
		if (!runtime) return;
		const resolved = resolve(entityId, el);
		if (!resolved) return;
		void openObjectMenu(point, {
			target: {
				entityId,
				entityType: resolved.entityType,
				label: resolved.label,
			},
			runtime,
			labels: labels(),
			...(anchor ? { anchor } : {}),
			...(resolved.extraItems && resolved.extraItems.length > 0
				? { extraItems: resolved.extraItems }
				: {}),
			...(resolved.onRemove ? { onRemove: resolved.onRemove } : {}),
		});
	};

	container.addEventListener("contextmenu", (event) => {
		const el = resolveEntityElement(event.target);
		const entityId = el?.getAttribute(ENTITY_ID_ATTR);
		if (!entityId) return;
		event.preventDefault();
		openFor(entityId, el, { x: event.clientX, y: event.clientY });
	});

	container.addEventListener("click", (event) => {
		const moreButton = (event.target as HTMLElement | null)?.closest<HTMLElement>(
			`.${MORE_BUTTON_CLASS}`,
		);
		if (!moreButton) return;
		if (moreButton.getAttribute("aria-disabled") === "true") return;
		const el = resolveEntityElement(moreButton);
		const entityId = el?.getAttribute(ENTITY_ID_ATTR);
		if (!entityId) return;
		event.preventDefault();
		event.stopPropagation();
		const r = moreButton.getBoundingClientRect();
		openFor(entityId, el, { x: r.left, y: r.bottom + 4 }, moreButton);
	});
}

export { closeObjectMenu };
