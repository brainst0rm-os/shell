/**
 * InlineEditTextarea — the multi-line twin of `InlineEditInput`, used by
 * the Multiline text cell. Auto-grows to fit its content (no inner
 * scrollbar until a generous cap), commits on the commit chord (Enter)
 * or blur, reverts on the escape chord, and keeps Shift+Enter for an
 * explicit line break.
 *
 * The same `resolved` guard as `InlineEditInput` makes the edit resolve
 * exactly once so the trailing unmount-blur can't re-commit a reverted
 * draft. Keyboard routes through the shared seam matchers (no raw
 * `e.key`).
 */

import type { JSX, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { TextSurfaceKind, spellcheckForSurface } from "../../spellcheck";
import { usePropertyUiSeams } from "../use-properties";

const MAX_AUTO_GROW_PX = 320;

export type InlineEditTextareaProps = {
	initialValue: string;
	className: string;
	ariaLabel: string;
	onCommit: (raw: string) => void;
	onCancel: () => void;
};

export function InlineEditTextarea({
	initialValue,
	className,
	ariaLabel,
	onCommit,
	onCancel,
}: InlineEditTextareaProps): JSX.Element {
	const { commitMatcher, escapeMatcher } = usePropertyUiSeams();
	const [draft, setDraft] = useState(initialValue);
	const ref = useRef<HTMLTextAreaElement>(null);
	const resolved = useRef(false);

	const commit = useCallback(() => {
		if (resolved.current) return;
		resolved.current = true;
		onCommit(draft);
	}, [draft, onCommit]);

	const cancel = useCallback(() => {
		if (resolved.current) return;
		resolved.current = true;
		onCancel();
	}, [onCancel]);

	const onKeyDown = useCallback(
		(e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
			if (escapeMatcher(e)) {
				e.preventDefault();
				cancel();
				return;
			}
			// Enter commits; Shift+Enter falls through to insert a line break.
			if (commitMatcher(e) && !e.shiftKey) {
				e.preventDefault();
				commit();
			}
		},
		[commitMatcher, escapeMatcher, commit, cancel],
	);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		el.focus();
		el.setSelectionRange(el.value.length, el.value.length);
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `draft` is the resize trigger — the body reads the live element height (not `draft`), so the effect must re-run on every keystroke to fit the new content.
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		el.style.height = "auto";
		// border-box: scrollHeight excludes the borders, so add them back or
		// the box lands short of its content and the row shifts on edit.
		const borders = el.offsetHeight - el.clientHeight;
		el.style.height = `${Math.min(el.scrollHeight + borders, MAX_AUTO_GROW_PX)}px`;
	}, [draft]);

	return (
		<textarea
			ref={ref}
			className={className}
			value={draft}
			rows={1}
			aria-label={ariaLabel}
			spellCheck={spellcheckForSurface(TextSurfaceKind.Prose)}
			onChange={(e) => setDraft(e.target.value)}
			onBlur={commit}
			onKeyDown={onKeyDown}
		/>
	);
}
