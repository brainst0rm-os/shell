/**
 * Source-context chip — "From note: …", "From folder: …", "3 items". Shown
 * in the header when Preview was opened from a gallery context; hidden for a
 * single-file context (the caller passes `null` and renders nothing).
 */

import type { ReactElement } from "react";
import type { PreviewContextKind } from "../types/preview-context";

export function SourceChip({
	kind,
	label,
}: {
	kind: PreviewContextKind;
	label: string;
}): ReactElement {
	return (
		<span className="preview__source-chip" data-kind={kind} title={label}>
			<span className="preview__source-chip-icon" aria-hidden="true" />
			<span className="preview__source-chip-label">{label}</span>
		</span>
	);
}
