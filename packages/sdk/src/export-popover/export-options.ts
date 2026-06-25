/**
 * Declarative option model for the shared export popover.
 *
 * An app describes its export as a set of formats, each carrying its own
 * options form, plus options common to every format. The popover renders the
 * form and hands back a flat `{ formatId, values }` result; the app owns what
 * the values mean (delimiter, column subset, …). Keeping the model pure means
 * the default/merge/validation rules are tested without a DOM, and the same
 * spec drives both the renderer and the tests.
 */

export enum ExportOptionKind {
	Toggle = "toggle",
	Select = "select",
	Checklist = "checklist",
}

export interface ExportChoice {
	value: string;
	label: string;
}

export interface ExportToggleOption {
	kind: ExportOptionKind.Toggle;
	id: string;
	label: string;
	default: boolean;
}

export interface ExportSelectOption {
	kind: ExportOptionKind.Select;
	id: string;
	label: string;
	choices: readonly ExportChoice[];
	default: string;
}

export interface ExportChecklistOption {
	kind: ExportOptionKind.Checklist;
	id: string;
	label: string;
	choices: readonly ExportChoice[];
	default: readonly string[];
	/** Require at least one box checked before Export enables. Default false. */
	requireOne?: boolean;
}

export type ExportOption = ExportToggleOption | ExportSelectOption | ExportChecklistOption;

export type ExportOptionValue = boolean | string | string[];
export type ExportValues = Record<string, ExportOptionValue>;

export interface ExportFormatSpec {
	id: string;
	label: string;
	/** Options specific to this format, rendered after the common options. */
	options?: readonly ExportOption[];
}

export interface ExportPopoverSpec {
	/** Options shared across every format, rendered before the format's own. */
	commonOptions?: readonly ExportOption[];
	formats: readonly ExportFormatSpec[];
	/** Initially-selected format. Defaults to the first format. */
	defaultFormatId?: string;
}

function formatById(spec: ExportPopoverSpec, formatId: string): ExportFormatSpec | undefined {
	return spec.formats.find((f) => f.id === formatId);
}

/** The initially-selected format id: the requested default if it exists, else
 *  the first format. */
export function initialFormatId(spec: ExportPopoverSpec): string {
	const requested = spec.defaultFormatId;
	if (requested && formatById(spec, requested)) return requested;
	return spec.formats[0]?.id ?? "";
}

/** Active options for a format: common options followed by that format's own,
 *  in declaration order. Unknown format id → just the common options. */
export function optionsForFormat(spec: ExportPopoverSpec, formatId: string): ExportOption[] {
	return [...(spec.commonOptions ?? []), ...(formatById(spec, formatId)?.options ?? [])];
}

function defaultValue(option: ExportOption): ExportOptionValue {
	switch (option.kind) {
		case ExportOptionKind.Toggle:
			return option.default;
		case ExportOptionKind.Select:
			return option.default;
		case ExportOptionKind.Checklist:
			return [...option.default];
	}
}

/** Default values for a format's active options. */
export function defaultValuesFor(spec: ExportPopoverSpec, formatId: string): ExportValues {
	const values: ExportValues = {};
	for (const option of optionsForFormat(spec, formatId)) values[option.id] = defaultValue(option);
	return values;
}

/**
 * Carry the current values across a format switch: every active option in the
 * new format keeps its current value when its id is still present and the
 * value shape matches, otherwise it falls back to the option default. This is
 * what lets a shared "Columns" selection survive switching CSV → JSON while a
 * format-only option (delimiter) resets to its default when it reappears.
 */
export function reconcileValues(
	spec: ExportPopoverSpec,
	formatId: string,
	previous: ExportValues,
): ExportValues {
	const next: ExportValues = {};
	for (const option of optionsForFormat(spec, formatId)) {
		const carried = previous[option.id];
		next[option.id] = valueMatchesKind(option, carried) ? carried : defaultValue(option);
	}
	return next;
}

function valueMatchesKind(
	option: ExportOption,
	value: ExportOptionValue | undefined,
): value is ExportOptionValue {
	if (value === undefined) return false;
	switch (option.kind) {
		case ExportOptionKind.Toggle:
			return typeof value === "boolean";
		case ExportOptionKind.Select:
			return typeof value === "string";
		case ExportOptionKind.Checklist:
			return Array.isArray(value);
	}
}

/** Whether the values satisfy every `requireOne` checklist among the active
 *  options — drives the Export button's enabled state. */
export function exportValuesComplete(
	options: readonly ExportOption[],
	values: ExportValues,
): boolean {
	for (const option of options) {
		if (option.kind === ExportOptionKind.Checklist && option.requireOne) {
			const value = values[option.id];
			if (!Array.isArray(value) || value.length === 0) return false;
		}
	}
	return true;
}
