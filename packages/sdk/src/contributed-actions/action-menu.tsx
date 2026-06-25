/**
 * `<ActionMenu>` — the React host primitive of the action surface (doc 63
 * §Host side). It is the single, documented way an app drops a
 * contribution-aware menu into its own tree: a trigger whose activation opens
 * the shared object-menu popup (which already surfaces the app's built-ins,
 * "Open with…", and — since AS-1 — every applicable contributed action,
 * grouped + capped + trust-quarantined). There is exactly ONE renderer for a
 * registry contribution (`openObjectMenu` → `buildContributedRows`); this
 * component is the React trigger surface over it, so no app hand-rolls menu
 * chrome (the DRY standing rule).
 *
 * It delegates to `<ObjectMenuTrigger>` so right-click + the ⋯ overflow button,
 * anchoring, a11y, and theming all come from the shared object-menu code. The
 * `target`/`verbs` flow through the runtime's `intents.suggestActions` inside
 * `openObjectMenu`; an app needs no per-action wiring.
 */

import type { ReactElement, ReactNode } from "react";
import { ObjectMenuMoreButton, ObjectMenuTrigger } from "../object-menu";
import type { ObjectMenuContext } from "../object-menu";

export type ActionMenuProps = {
	/** Resolved at open time so the menu reflects the current object; `null`
	 *  makes the trigger inert (a fresh / empty target). Same contract as
	 *  `<ObjectMenuTrigger>`. */
	context: () => ObjectMenuContext;
	/** `aria-label` / tooltip for the ⋯ overflow trigger and the menu region. */
	moreActionsLabel: string;
	/** The content the right-click opener wraps (a header title, a row, a card). */
	children: ReactNode;
	className?: string;
	/** Suppress the inline ⋯ button (e.g. when a standalone
	 *  `<ActionMenu.MoreButton>` lives elsewhere in a header). */
	noMoreButton?: boolean;
};

/** A standalone ⋯ overflow button bound to the same `context` — for a header
 *  whose ⋯ sits apart from the right-click-able title (the SDK header rule). */
function ActionMenuMoreButton(props: {
	context: () => ObjectMenuContext;
	moreActionsLabel: string;
	disabled?: boolean;
}): ReactElement {
	return (
		<ObjectMenuMoreButton
			context={props.context}
			moreActionsLabel={props.moreActionsLabel}
			{...(props.disabled !== undefined ? { disabled: props.disabled } : {})}
		/>
	);
}

export function ActionMenu(props: ActionMenuProps): ReactElement {
	return (
		<ObjectMenuTrigger
			context={props.context}
			moreActionsLabel={props.moreActionsLabel}
			{...(props.className !== undefined ? { className: props.className } : {})}
			{...(props.noMoreButton ? { noMoreButton: true } : {})}
		>
			{props.children}
		</ObjectMenuTrigger>
	);
}

ActionMenu.MoreButton = ActionMenuMoreButton;
