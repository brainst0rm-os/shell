/**
 * Pure source-context label helpers — turn a `PreviewContext` into the
 * prefix + default label the header chip shows ("From note: …", "From
 * folder: …", "3 items"). Framework-free so the label logic is unit-tested
 * without a DOM; the React `<SourceChip>` consumes them.
 */

import { plural, t } from "../i18n";
import { type PreviewContext, PreviewContextKind } from "../types/preview-context";

export function contextPrefixFor(kind: PreviewContextKind): string {
	switch (kind) {
		case PreviewContextKind.Note:
			return t("context.fromNote");
		case PreviewContextKind.Folder:
			return t("context.fromFolder");
		case PreviewContextKind.Selection:
			return t("context.selection");
		default:
			return t("context.fromGeneric");
	}
}

export function defaultContextLabel(kind: PreviewContextKind, itemCount: number): string {
	switch (kind) {
		case PreviewContextKind.Note:
			return t("context.untitledNote");
		case PreviewContextKind.Folder:
			return t("context.untitledFolder");
		case PreviewContextKind.Selection:
			return plural(itemCount, "context.itemCount.one", "context.itemCount.other");
		default:
			return "";
	}
}

/** Full chip label ("From folder: Release docs"), or `null` when the chip
 *  is hidden (no context, or a single-file context). */
export function chipLabelFor(
	context: PreviewContext | null,
	itemCount: number,
): { label: string; kind: PreviewContextKind } | null {
	if (!context || context.kind === PreviewContextKind.Single) return null;
	const label = context.label ?? defaultContextLabel(context.kind, itemCount);
	return { label: `${contextPrefixFor(context.kind)} ${label}`, kind: context.kind };
}
