/**
 * `createSelectMenu` — the pure-DOM twin of `<SelectMenu>` for the
 * imperative-built surfaces still on the all-apps-React migration track
 * (database view-settings, the imperative recurrence editor). Same
 * `.bs-select` trigger DOM, same `openSelectMenu` popup, so the control is
 * bit-identical with the React one.
 */

import { createIconElement } from "../icon/create-icon-element";
import { IconName } from "../icon/icon-registry";
import { openSelectMenu } from "./open-select-menu";
import type { SelectMenuOption } from "./open-select-menu";
import "./select-menu.css";

export type CreateSelectMenuParams<T extends string = string> = {
	options: readonly SelectMenuOption<T>[];
	value: T | null;
	/** Accessible name for the trigger AND the popup list. */
	ariaLabel: string;
	/** Shown when `value` matches no option (the empty / unset state). */
	placeholder?: string;
	className?: string;
	onChange(next: T): void;
};

export type SelectMenuHandle<T extends string = string> = {
	element: HTMLButtonElement;
	getValue(): T | null;
	/** Reflect an external value change on the trigger (does NOT fire onChange). */
	setValue(next: T | null): void;
	setOptions(next: readonly SelectMenuOption<T>[]): void;
};

export function createSelectMenu<T extends string>(
	params: CreateSelectMenuParams<T>,
): SelectMenuHandle<T> {
	let options = params.options;
	let value = params.value;

	const trigger = document.createElement("button");
	trigger.type = "button";
	trigger.className = params.className ? `bs-select ${params.className}` : "bs-select";
	trigger.setAttribute("aria-haspopup", "menu");
	trigger.setAttribute("aria-label", params.ariaLabel);

	const valueEl = document.createElement("span");
	trigger.appendChild(valueEl);
	const caret = createIconElement(IconName.CaretDown, { size: 12 });
	caret.classList.add("bs-select__caret");
	trigger.appendChild(caret);

	const render = (): void => {
		const current = options.find((option) => option.value === value);
		valueEl.className = current ? "bs-select__value" : "bs-select__value bs-select__value--empty";
		valueEl.textContent = current ? current.label : (params.placeholder ?? "");
	};
	render();

	trigger.addEventListener("click", () => {
		openSelectMenu({
			anchor: trigger,
			menuLabel: params.ariaLabel,
			options,
			value,
			onSelect: (next) => {
				value = next;
				render();
				params.onChange(next);
			},
		});
	});

	return {
		element: trigger,
		getValue: () => value,
		setValue: (next) => {
			value = next;
			render();
		},
		setOptions: (next) => {
			options = next;
			render();
		},
	};
}
