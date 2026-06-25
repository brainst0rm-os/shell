/**
 * `attachObjectMenuTrigger` — wires an element to the shared object menu on
 * BOTH affordances the cross-app contract mandates: right-click
 * (`contextmenu`) anywhere on the element, AND a visible ⋯ overflow button
 * (discoverable; keyboard- and pointer-reachable). One call, both paths,
 * the same menu — so no app re-implements the glue.
 *
 * The host supplies a `context()` provider invoked at open time (not at
 * attach time) so the menu always reflects the element's current object —
 * the same row element can be reused across re-renders. Returning `null`
 * from the provider is a no-op (e.g. the row has no bound entity yet).
 *
 * The ⋯ button is created here (chrome the app shouldn't re-style); the
 * caller appends the returned node wherever its row layout wants it. Both
 * paths position the menu sensibly: right-click at the cursor, the ⋯ click
 * just below the button.
 */

import { matchesChord } from "../shortcut/chord";
import { closeObjectMenu, openObjectMenu } from "./open-object-menu";
import type { OpenObjectMenuOptions } from "./open-object-menu";

const ACTIVATE_CHORD_ENTER = "Enter";
const ACTIVATE_CHORD_SPACE = "Space";
const MORE_BUTTON_GAP = 4;

/** What the menu should act on, resolved lazily at open time. `null` →
 *  the trigger does nothing (no bound object). */
export type ObjectMenuContext = OpenObjectMenuOptions | null;

export type AttachObjectMenuTriggerOptions = {
	/** `aria-label` / tooltip for the ⋯ button. Falls back to the
	 *  resolved chrome label inside the menu if omitted. */
	moreActionsLabel: string;
};

export type ObjectMenuTriggerHandle = {
	/** The created ⋯ overflow button — append it into the row chrome. */
	readonly moreButton: HTMLButtonElement;
	/** Detach both listeners + drop the ⋯ button. Idempotent. */
	dispose(): void;
};

function openAt(
	point: { x: number; y: number },
	context: ObjectMenuContext,
	anchor?: HTMLElement,
): void {
	if (!context) return;
	void openObjectMenu(point, anchor ? { ...context, anchor } : context);
}

export function attachObjectMenuTrigger(
	el: HTMLElement,
	context: () => ObjectMenuContext,
	options: AttachObjectMenuTriggerOptions,
): ObjectMenuTriggerHandle {
	const onContextMenu = (event: MouseEvent): void => {
		const ctx = context();
		if (!ctx) return;
		event.preventDefault();
		openAt({ x: event.clientX, y: event.clientY }, ctx);
	};

	const moreButton = document.createElement("button");
	moreButton.type = "button";
	moreButton.className = "bs-object-menu__more";
	moreButton.setAttribute("aria-haspopup", "menu");
	moreButton.setAttribute("aria-label", options.moreActionsLabel);
	moreButton.dataset.bsTooltip = options.moreActionsLabel;
	for (let i = 0; i < 3; i++) {
		const dot = document.createElement("span");
		dot.className = "bs-object-menu__more-dot";
		moreButton.appendChild(dot);
	}

	const openFromButton = (): void => {
		const ctx = context();
		if (!ctx) return;
		const r = moreButton.getBoundingClientRect();
		openAt({ x: r.left, y: r.bottom + MORE_BUTTON_GAP }, ctx, moreButton);
	};
	const onMoreClick = (event: MouseEvent): void => {
		event.preventDefault();
		event.stopPropagation();
		openFromButton();
	};
	const onMoreKey = (event: KeyboardEvent): void => {
		if (event.defaultPrevented) return;
		if (matchesChord(event, ACTIVATE_CHORD_ENTER) || matchesChord(event, ACTIVATE_CHORD_SPACE)) {
			event.preventDefault();
			openFromButton();
		}
	};

	el.addEventListener("contextmenu", onContextMenu);
	moreButton.addEventListener("click", onMoreClick);
	moreButton.addEventListener("keydown", onMoreKey);

	let disposed = false;
	return {
		moreButton,
		dispose() {
			if (disposed) return;
			disposed = true;
			el.removeEventListener("contextmenu", onContextMenu);
			moreButton.removeEventListener("click", onMoreClick);
			moreButton.removeEventListener("keydown", onMoreKey);
			moreButton.remove();
			closeObjectMenu();
		},
	};
}
