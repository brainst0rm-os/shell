/**
 * FormattedCell — the single Text scalar cell (Pill / Plain). For the
 * `text + format` kinds (Url / Email / Phone) an invalid value paints a
 * red border and exposes the reason via `title`. `mode` picks the
 * resting chrome: Pill (chip) or Plain (inline text).
 */

import { type CellProps, PropertyFormat } from "@brainstorm/sdk-types";
import type { JSX } from "react";
import { useCallback, useState } from "react";
import { coerceValue } from "../../properties-validate";
import type { PropertyUiLabels } from "../seams";
import { usePropertyUiSeams } from "../use-properties";
import { formatScalar, isValidFormatted, parseScalar } from "./format";
import { InlineEditInput } from "./inline-edit-input";
import { useCellAutoEdit } from "./use-cell-auto-edit";

export enum FormattedMode {
	Pill = "pill",
	Plain = "plain",
}

function invalidMessage(
	format: PropertyFormat | undefined,
	labels: PropertyUiLabels,
): string | undefined {
	switch (format) {
		case PropertyFormat.Url:
			return labels.formatInvalidUrl;
		case PropertyFormat.Email:
			return labels.formatInvalidEmail;
		case PropertyFormat.Phone:
			return labels.formatInvalidPhone;
		default:
			return undefined;
	}
}

function makeFormattedCell(mode: FormattedMode) {
	return function FormattedCell(props: CellProps): JSX.Element {
		const { property, value, onChange, readOnly, autoEdit, onAutoEditHandled } = props;
		const { labels } = usePropertyUiSeams();
		const [editing, setEditing] = useState(false);
		useCellAutoEdit(autoEdit, readOnly, () => setEditing(true), onAutoEditHandled);
		const display = formatScalar(property, value);
		const invalid = !isValidFormatted(property.format, display);
		const invalidMsg = invalid ? invalidMessage(property.format, labels) : undefined;

		const onCommit = useCallback(
			(raw: string) => {
				onChange(coerceValue(property, parseScalar(property, raw)) as never);
				setEditing(false);
			},
			[property, onChange],
		);

		const base = mode === FormattedMode.Pill ? "bs-cell-pill" : "bs-cell-plain";

		if (editing && !readOnly) {
			const inputClass = mode === FormattedMode.Pill ? "bs-cell-input" : "bs-cell-plain-input";
			return (
				<InlineEditInput
					initialValue={display}
					className={invalid ? `${inputClass} ${inputClass}--invalid` : inputClass}
					ariaLabel={labels.cellEditValueFor(property.name)}
					onCommit={onCommit}
					onCancel={() => setEditing(false)}
				/>
			);
		}

		const cls = [
			base,
			display.length === 0 ? `${base}--empty` : "",
			invalid ? `${base}--invalid` : "",
		]
			.filter(Boolean)
			.join(" ");

		return (
			<button
				type="button"
				className={cls}
				onClick={() => !readOnly && setEditing(true)}
				disabled={readOnly}
				aria-invalid={invalid || undefined}
				title={invalidMsg}
				aria-label={
					invalidMsg
						? `${labels.cellEditValueFor(property.name)} — ${invalidMsg}`
						: labels.cellEditValueFor(property.name)
				}
			>
				<span className={mode === FormattedMode.Pill ? "bs-cell-pill-text" : undefined}>
					{display.length === 0 ? labels.cellEmpty : display}
				</span>
			</button>
		);
	};
}

export const FormattedPillCell = makeFormattedCell(FormattedMode.Pill);
export const FormattedPlainCell = makeFormattedCell(FormattedMode.Plain);
