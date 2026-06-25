/**
 * openExportPopover — a shared, declarative export dialog for plain-DOM apps.
 *
 * Built on `createPopoverElement` (same glass chrome / Escape / backdrop), it
 * renders a format radiogroup plus the active format's options form (see
 * `export-options.ts`) and an Export / Cancel footer. The Export button stays
 * disabled until the values satisfy every `requireOne` checklist. The app owns
 * what the values mean — the popover just collects them and calls `onExport`
 * with `{ formatId, values }`.
 *
 * Why here and not per app: Database, Graph and Whiteboard all expose "export
 * to <format>"; the only app-specific part is the spec + what `onExport` does.
 * Centralising the chrome keeps the affordance identical and the a11y wiring
 * (fieldset/legend radiogroup, labelled controls) in one place.
 */

import { createCheckbox } from "../checkbox";
import { type PopoverHandle, createPopoverElement } from "../popover/create-popover-element";
import { PopoverBodyPadding, PopoverSize } from "../popover/popover-shared";
import { createRadio } from "../radio";
import { createSelectMenu } from "../select-menu/create-select-menu";
import {
	type ExportOption,
	ExportOptionKind,
	type ExportPopoverSpec,
	type ExportValues,
	defaultValuesFor,
	exportValuesComplete,
	initialFormatId,
	optionsForFormat,
	reconcileValues,
} from "./export-options";
import "./export-popover.css";

export interface ExportPopoverLabels {
	title: string;
	/** Legend over the format radiogroup, e.g. "Format". */
	formatLegend: string;
	exportAction: string;
	cancel: string;
}

export interface ExportPopoverResult {
	formatId: string;
	values: ExportValues;
}

export interface OpenExportPopoverOptions {
	spec: ExportPopoverSpec;
	labels: ExportPopoverLabels;
	/** Invoked when Export is pressed. The popover closes right after; the app
	 *  surfaces its own progress/result (mirrors the export-flow toast). */
	onExport: (result: ExportPopoverResult) => void | Promise<void>;
	/** Invoked on any dismissal (Cancel button, backdrop, Escape, close). */
	onCancel?: () => void;
	testId?: string;
}

export function openExportPopover(options: OpenExportPopoverOptions): PopoverHandle {
	const { spec, labels } = options;
	let formatId = initialFormatId(spec);
	let values: ExportValues = defaultValuesFor(spec, formatId);

	const body = document.createElement("div");
	body.className = "bs-export-popover";

	// Format radiogroup.
	const formatGroup = document.createElement("fieldset");
	formatGroup.className = "bs-export-popover__formats";
	const formatLegend = document.createElement("legend");
	formatLegend.className = "bs-export-popover__legend";
	formatLegend.textContent = labels.formatLegend;
	formatGroup.appendChild(formatLegend);
	const formatRadioName = "bs-export-format";
	for (const format of spec.formats) {
		const radio = createRadio({
			name: formatRadioName,
			value: format.id,
			label: format.label,
			checked: format.id === formatId,
			onSelect: () => switchFormat(format.id),
		});
		radio.element.classList.add("bs-export-popover__format");
		formatGroup.appendChild(radio.element);
	}

	const optionsHost = document.createElement("div");
	optionsHost.className = "bs-export-popover__options";

	body.append(formatGroup, optionsHost);

	// Footer.
	const footer = document.createElement("div");
	footer.className = "bs-export-popover__footer";
	const cancelBtn = document.createElement("button");
	cancelBtn.type = "button";
	cancelBtn.className = "bs-export-popover__btn";
	cancelBtn.textContent = labels.cancel;
	const exportBtn = document.createElement("button");
	exportBtn.type = "button";
	exportBtn.className = "bs-export-popover__btn";
	exportBtn.dataset.bsPrimary = "";
	exportBtn.textContent = labels.exportAction;
	footer.append(cancelBtn, exportBtn);

	let dismissed = false;
	const dismiss = (): void => {
		if (dismissed) return;
		dismissed = true;
		options.onCancel?.();
	};

	const handle = createPopoverElement({
		title: labels.title,
		body,
		footer,
		size: PopoverSize.Medium,
		bodyPadding: PopoverBodyPadding.Comfortable,
		onClose: dismiss,
		...(options.testId ? { testId: options.testId } : {}),
	});

	function refreshExportEnabled(): void {
		exportBtn.disabled = !exportValuesComplete(optionsForFormat(spec, formatId), values);
	}

	function renderOptions(): void {
		optionsHost.replaceChildren();
		for (const option of optionsForFormat(spec, formatId)) {
			optionsHost.appendChild(renderOption(option, values, refreshExportEnabled));
		}
	}

	function switchFormat(next: string): void {
		values = reconcileValues(spec, next, values);
		formatId = next;
		renderOptions();
		refreshExportEnabled();
	}

	cancelBtn.addEventListener("click", () => {
		dismiss();
		handle.close();
	});
	exportBtn.addEventListener("click", () => {
		// Mark dismissed so the trailing close() doesn't also fire onCancel.
		dismissed = true;
		void options.onExport({ formatId, values: { ...values } });
		handle.close();
	});

	renderOptions();
	refreshExportEnabled();
	// Focus the selected format so the popover is keyboard-ready on open.
	const firstRadio = formatGroup.querySelector<HTMLInputElement>("input[type=radio]:checked");
	firstRadio?.focus();

	return handle;
}

function renderOption(
	option: ExportOption,
	values: ExportValues,
	onChange: () => void,
): HTMLElement {
	switch (option.kind) {
		case ExportOptionKind.Toggle:
			return renderToggle(option, values, onChange);
		case ExportOptionKind.Select:
			return renderSelect(option, values, onChange);
		case ExportOptionKind.Checklist:
			return renderChecklist(option, values, onChange);
	}
}

function renderToggle(
	option: Extract<ExportOption, { kind: ExportOptionKind.Toggle }>,
	values: ExportValues,
	onChange: () => void,
): HTMLElement {
	const checkbox = createCheckbox({
		label: option.label,
		checked: values[option.id] === true,
		onChange: (checked) => {
			values[option.id] = checked;
			onChange();
		},
	});
	checkbox.element.classList.add("bs-export-popover__option", "bs-export-popover__option--toggle");
	return checkbox.element;
}

function renderSelect(
	option: Extract<ExportOption, { kind: ExportOptionKind.Select }>,
	values: ExportValues,
	onChange: () => void,
): HTMLElement {
	const row = document.createElement("label");
	row.className = "bs-export-popover__option bs-export-popover__option--select";
	const text = document.createElement("span");
	text.className = "bs-export-popover__option-label";
	text.textContent = option.label;
	const handle = createSelectMenu({
		options: option.choices.map((choice) => ({ value: choice.value, label: choice.label })),
		value: typeof values[option.id] === "string" ? (values[option.id] as string) : option.default,
		ariaLabel: option.label,
		className: "bs-select--sm",
		onChange: (next) => {
			values[option.id] = next;
			onChange();
		},
	});
	row.append(text, handle.element);
	return row;
}

function renderChecklist(
	option: Extract<ExportOption, { kind: ExportOptionKind.Checklist }>,
	values: ExportValues,
	onChange: () => void,
): HTMLElement {
	const group = document.createElement("fieldset");
	group.className = "bs-export-popover__option bs-export-popover__option--checklist";
	const legend = document.createElement("legend");
	legend.className = "bs-export-popover__option-label";
	legend.textContent = option.label;
	group.appendChild(legend);
	const current = new Set(Array.isArray(values[option.id]) ? (values[option.id] as string[]) : []);
	for (const choice of option.choices) {
		const checkbox = createCheckbox({
			label: choice.label,
			checked: current.has(choice.value),
			onChange: (checked) => {
				if (checked) current.add(choice.value);
				else current.delete(choice.value);
				// Preserve the option's declared order, not click order.
				values[option.id] = option.choices.map((c) => c.value).filter((v) => current.has(v));
				onChange();
			},
		});
		checkbox.input.value = choice.value;
		checkbox.element.classList.add("bs-export-popover__check");
		group.appendChild(checkbox.element);
	}
	return group;
}
