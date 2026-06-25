/**
 * InlineEditInput — the single inline text editor shared by every scalar
 * cell (Pill / Plain / Formatted). Auto-focuses + selects on mount, commits
 * on the commit chord (Enter) or on blur, reverts on the escape chord.
 *
 * A `resolved` guard makes the edit resolve EXACTLY once: when Enter or
 * Escape resolves the edit the parent unmounts this input, which fires a
 * trailing `blur` — the guard turns that blur into a no-op. Without it
 * Escape would still commit the draft through the unmount-blur (so it never
 * truly reverted) and Enter would commit twice. Keyboard routes through the
 * shared `useInlineEditKeyDown` (host seams), so no raw `e.key` lives here.
 */

import type { JSX } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useInlineEditKeyDown } from "./inline-edit-keys";

export type InlineEditInputProps = {
	initialValue: string;
	inputType?: "text" | "number";
	className: string;
	ariaLabel: string;
	onCommit: (raw: string) => void;
	onCancel: () => void;
	/** B11.16b — spellcheck this field. Defaults off: scalar cells (pill /
	 *  formatted / number) are structured values, not prose. Prose text cells
	 *  (Plain) pass `spellcheckForSurface(TextSurfaceKind.Prose)`. */
	spellCheck?: boolean;
};

export function InlineEditInput({
	initialValue,
	inputType = "text",
	className,
	ariaLabel,
	onCommit,
	onCancel,
	spellCheck = false,
}: InlineEditInputProps): JSX.Element {
	const [draft, setDraft] = useState(initialValue);
	const ref = useRef<HTMLInputElement>(null);
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

	const onKeyDown = useInlineEditKeyDown(commit, cancel);

	useEffect(() => {
		ref.current?.focus();
		ref.current?.select();
	}, []);

	return (
		<input
			ref={ref}
			className={className}
			type={inputType}
			value={draft}
			aria-label={ariaLabel}
			spellCheck={spellCheck}
			onChange={(e) => setDraft(e.target.value)}
			onBlur={commit}
			onKeyDown={onKeyDown}
		/>
	);
}
