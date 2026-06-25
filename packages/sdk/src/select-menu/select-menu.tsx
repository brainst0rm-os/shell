/**
 * `<SelectMenu>` — the React trigger for the shared select control: a
 * `.bs-select` button showing the chosen option's label + a caret, opening
 * the option list through the fancy-menus runtime (`openSelectMenu`). The
 * native-`<select>` replacement every app and the shell renderer use, per
 * the CLAUDE.md no-bespoke-menu-chrome rule.
 *
 * Fully controlled: the host owns `value` and updates it from `onChange`.
 * The open/active state (`aria-expanded`) is stamped on the trigger by the
 * shared context-menu opener for as long as the menu is up.
 */

import { useRef } from "react";
import { Icon } from "../icon/icon";
import { IconName } from "../icon/icon-registry";
import { openSelectMenu } from "./open-select-menu";
import type { SelectMenuOption } from "./open-select-menu";
import "./select-menu.css";

export type SelectMenuProps<T extends string = string> = {
	value: T | null;
	options: readonly SelectMenuOption<T>[];
	onChange(next: T): void;
	/** Accessible name for the trigger AND the popup list. */
	ariaLabel: string;
	/** Shown when `value` matches no option (the empty / unset state). */
	placeholder?: string;
	id?: string;
	className?: string;
	disabled?: boolean;
	"data-testid"?: string;
};

export function SelectMenu<T extends string>({
	value,
	options,
	onChange,
	ariaLabel,
	placeholder,
	id,
	className,
	disabled,
	"data-testid": dataTestId,
}: SelectMenuProps<T>) {
	const triggerRef = useRef<HTMLButtonElement>(null);
	const current = options.find((option) => option.value === value);
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
				openSelectMenu({ anchor, menuLabel: ariaLabel, options, value, onSelect: onChange });
			}}
		>
			<span className={current ? "bs-select__value" : "bs-select__value bs-select__value--empty"}>
				{current ? current.label : (placeholder ?? "")}
			</span>
			<Icon name={IconName.CaretDown} size={12} className="bs-select__caret" />
		</button>
	);
}
