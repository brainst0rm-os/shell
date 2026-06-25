/**
 * `<MultiSelectMenu>` — the multi-select sibling of `<SelectMenu>`: the same
 * `.bs-select` trigger face, but its popup lets the user toggle any number of
 * options on/off (the "links to these types" / tag-set case) instead of
 * picking one. The trigger summarises the current selection; the popup is the
 * shared fancy-menus runtime (`openMultiSelectMenu`), per the no-bespoke-menu
 * rule.
 *
 * Fully controlled: the host owns `selected` and updates it from `onChange`.
 */

import { useRef } from "react";
import { Icon } from "../icon/icon";
import { IconName } from "../icon/icon-registry";
import type { MultiSelectMenuOption } from "./open-multi-select-menu";
import { openMultiSelectMenu } from "./open-multi-select-menu";
import "./select-menu.css";

export type MultiSelectMenuProps = {
	selected: readonly string[];
	options: readonly MultiSelectMenuOption[];
	onChange(next: readonly string[]): void;
	/** Accessible name for the trigger AND the popup list. */
	ariaLabel: string;
	/** Shown when nothing is selected (the "links to anything" default). */
	placeholder?: string;
	id?: string;
	className?: string;
	disabled?: boolean;
	"data-testid"?: string;
};

/** A compact summary of the chosen options: nothing → placeholder; one or two
 *  → their labels; more → the first label plus a "+N" overflow count. The
 *  trigger is narrow, so the label face ellipsises whatever this returns. */
function summarize(
	selected: readonly string[],
	options: readonly MultiSelectMenuOption[],
): string | null {
	if (selected.length === 0) return null;
	const labelFor = (id: string) => options.find((o) => o.id === id)?.label ?? id;
	const labels = selected.map(labelFor);
	if (labels.length <= 2) return labels.join(", ");
	return `${labels[0]} +${labels.length - 1}`;
}

export function MultiSelectMenu({
	selected,
	options,
	onChange,
	ariaLabel,
	placeholder,
	id,
	className,
	disabled,
	"data-testid": dataTestId,
}: MultiSelectMenuProps) {
	const triggerRef = useRef<HTMLButtonElement>(null);
	const summary = summarize(selected, options);
	return (
		<button
			ref={triggerRef}
			type="button"
			className={className ? `bs-select ${className}` : "bs-select"}
			aria-haspopup="menu"
			aria-label={ariaLabel}
			disabled={disabled ?? false}
			{...(id !== undefined ? { id } : {})}
			{...(dataTestId !== undefined ? { "data-testid": dataTestId } : {})}
			onClick={() => {
				const anchor = triggerRef.current;
				if (!anchor) return;
				openMultiSelectMenu({ anchor, menuLabel: ariaLabel, options, selected, onChange });
			}}
		>
			<span className={summary ? "bs-select__value" : "bs-select__value bs-select__value--empty"}>
				{summary ?? placeholder ?? ""}
			</span>
			<Icon name={IconName.CaretDown} size={12} className="bs-select__caret" />
		</button>
	);
}
