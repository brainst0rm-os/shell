/**
 * The commit-on-Enter / cancel-on-Escape keydown handler every inline
 * text-editing cell shares (PillCell, PlainCell, ProgressBarCell,
 * FormattedCell). The chord predicates come from the host seams
 * (`usePropertyUiSeams`) so Notes routes them through its shortcut
 * registry while a bare consumer falls back to Enter/Escape — no raw
 * `e.key` outside `./seams`.
 */

import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useCallback } from "react";
import { usePropertyUiSeams } from "../use-properties";

export function useInlineEditKeyDown(
	onCommit: () => void,
	onCancel: () => void,
): (event: ReactKeyboardEvent) => void {
	const { commitMatcher, escapeMatcher } = usePropertyUiSeams();
	return useCallback(
		(event: ReactKeyboardEvent) => {
			if (commitMatcher(event)) {
				event.preventDefault();
				onCommit();
			} else if (escapeMatcher(event)) {
				event.preventDefault();
				onCancel();
			}
		},
		[commitMatcher, escapeMatcher, onCommit, onCancel],
	);
}
