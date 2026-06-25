/**
 * `attachSearchbar` — the shared search-input chrome (leading magnifier,
 * `<input type="search">`, trailing clear ✕). Six surfaces had hand-rolled
 * copies (tasks / notes / whiteboard / settings / marketplace / cheatsheet),
 * three of which drifted: tasks shipped with the ✕ visible while empty
 * because `display: inline-flex` overrides the UA's `hidden=display:none`,
 * notes uses a different right-side affordance position, whiteboard had
 * already self-healed. One helper + one CSS block in `app-theme.ts` =
 * bit-identical chrome everywhere.
 *
 * The host appends `handle.root` wherever its layout wants it. Click /
 * keyboard activation on the clear ✕ resets the input value to `""` and
 * fires `onChange("")`; the host does NOT need to wire that.
 */

import { createIconElement } from "../icon/create-icon-element";
import { IconName } from "../icon/icon-registry";

export interface AttachSearchbarOptions {
	placeholder: string;
	/** Defaults to `placeholder`. */
	ariaLabel?: string;
	/** Localized label for the trailing ✕. Omit to suppress the button. */
	clearLabel?: string;
	initialValue?: string;
	/** Fires on every keystroke. Host may debounce externally. */
	onChange: (next: string) => void;
	/** Custom clear handler; defaults to `onChange("")` + refocus input. */
	onClear?: () => void;
	/** Optional `data-testid` on root + input. */
	testId?: string;
	inputTestId?: string;
}

export interface SearchbarHandle {
	root: HTMLLabelElement;
	input: HTMLInputElement;
	clearButton: HTMLButtonElement | null;
	focus(): void;
	select(): void;
	/** Update the input DOM value WITHOUT firing `onChange`. */
	setValue(value: string): void;
	getValue(): string;
	dispose(): void;
}

export function attachSearchbar(opts: AttachSearchbarOptions): SearchbarHandle {
	const root = document.createElement("label");
	root.className = "bs-searchbar";
	if (opts.testId) root.dataset.testid = opts.testId;

	const iconSpan = document.createElement("span");
	iconSpan.className = "bs-searchbar__icon";
	iconSpan.setAttribute("aria-hidden", "true");
	iconSpan.appendChild(createIconElement(IconName.Search, { size: 14 }));

	const input = document.createElement("input");
	input.type = "search";
	input.className = "bs-searchbar__input";
	input.autocomplete = "off";
	input.spellcheck = false;
	input.placeholder = opts.placeholder;
	input.setAttribute("aria-label", opts.ariaLabel ?? opts.placeholder);
	if (opts.initialValue) input.value = opts.initialValue;
	if (opts.inputTestId) input.dataset.testid = opts.inputTestId;

	let clearButton: HTMLButtonElement | null = null;
	if (opts.clearLabel !== undefined) {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "bs-searchbar__clear";
		button.setAttribute("aria-label", opts.clearLabel);
		button.dataset.bsTooltip = opts.clearLabel;
		button.hidden = (opts.initialValue ?? "").length === 0;
		button.appendChild(createIconElement(IconName.Close, { size: 12 }));
		clearButton = button;
	}

	const syncClearVisibility = (): void => {
		if (clearButton) clearButton.hidden = input.value.length === 0;
	};

	const onInput = (): void => {
		syncClearVisibility();
		opts.onChange(input.value);
	};

	const defaultClear = (): void => {
		input.value = "";
		syncClearVisibility();
		opts.onChange("");
		input.focus();
	};

	const onClearClick = (event: MouseEvent): void => {
		event.preventDefault();
		(opts.onClear ?? defaultClear)();
	};

	input.addEventListener("input", onInput);
	if (clearButton) clearButton.addEventListener("click", onClearClick);

	root.append(iconSpan, input);
	if (clearButton) root.appendChild(clearButton);

	let disposed = false;
	return {
		root,
		input,
		clearButton,
		focus: () => input.focus(),
		select: () => input.select(),
		setValue: (value: string) => {
			input.value = value;
			syncClearVisibility();
		},
		getValue: () => input.value,
		dispose() {
			if (disposed) return;
			disposed = true;
			input.removeEventListener("input", onInput);
			if (clearButton) clearButton.removeEventListener("click", onClearClick);
		},
	};
}
