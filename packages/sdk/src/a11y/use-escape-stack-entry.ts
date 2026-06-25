/**
 * `useEscapeStackEntry` — React binding for the module-scope `getEscapeStack()`.
 *
 * Replaces ad-hoc `useShortcut("shell/popover.close", onClose)` at every
 * overlay surface (popovers / dialogs / find-bars / cheatsheet / launcher /
 * capability-prompt / dashboard context menus / window-switcher). One
 * document-level handler — installed by the shell via `installEscapeHandler`
 * — owns delivery; this hook just pushes / pops the entry.
 *
 * StrictMode-safe:
 *   - Each hook instance owns a stable `useId()` entry id, so a double-mount
 *     pushes twice with the same id; the first off() removes the first
 *     occurrence, the second push restores presence, and the final off()
 *     leaves the stack empty.
 *   - `onEscape` is held in a ref so an inline arrow caller (`onEscape: () =>
 *     setOpen(false)`) doesn't churn the push/pop cycle every render.
 *   - The `enabled` toggle (default true) controls presence — flipping
 *     false→true re-pushes, true→false pops. This is the contract every
 *     migrated call site relies on (the window-switcher only pushes while
 *     `open`).
 */

import { useEffect, useId, useRef } from "react";
import { getEscapeStack } from "./escape-stack";

export type UseEscapeStackEntryOptions = {
	onEscape: () => void;
	enabled?: boolean;
	label?: string;
};

export function useEscapeStackEntry(options: UseEscapeStackEntryOptions): void {
	const id = useId();
	const enabled = options.enabled ?? true;
	const label = options.label;

	const onEscapeRef = useRef(options.onEscape);
	useEffect(() => {
		onEscapeRef.current = options.onEscape;
	}, [options.onEscape]);

	useEffect(() => {
		if (!enabled) return;
		const off = getEscapeStack().push({
			id,
			...(label !== undefined ? { openerLabel: label } : {}),
			onEscape: () => onEscapeRef.current(),
		});
		return off;
	}, [enabled, id, label]);
}
