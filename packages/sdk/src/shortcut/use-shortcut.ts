/**
 * `useShortcut` — the React twin of `attachShortcut`, mirroring the shell's
 * `renderer/shortcuts/use-shortcut.ts` hook shape (handler kept in a ref so
 * a re-render doesn't re-bind; effect re-runs on chord / enabled / target).
 *
 * Unlike the shell hook, the app supplies the chord string directly — there
 * is no `default-chords` registry dependency. `target` defaults to `window`;
 * pass a `RefObject<HTMLElement>` to scope the binding to a region.
 */

import { type RefObject, useEffect, useRef } from "react";
import { attachShortcut } from "./attach-shortcut";

export type UseShortcutTarget =
	| { kind: "global" }
	| { kind: "scope"; ref: RefObject<HTMLElement | null> };

export type UseShortcutOptions = {
	/** Activation target. Default: `{ kind: "global" }` (binds to window). */
	target?: UseShortcutTarget;
	/** Set to false to temporarily disable without unmounting. */
	enabled?: boolean;
};

export function useShortcut(
	chord: string,
	handler: (event: KeyboardEvent) => void,
	options: UseShortcutOptions = {},
): void {
	const handlerRef = useRef(handler);
	handlerRef.current = handler;

	const enabled = options.enabled ?? true;
	const target = options.target ?? { kind: "global" as const };
	const scopeRef = target.kind === "scope" ? target.ref : null;

	useEffect(() => {
		if (!enabled) return;
		const el: Window | HTMLElement | null =
			target.kind === "scope" ? (scopeRef?.current ?? null) : window;
		if (!el) return;
		return attachShortcut(el, chord, (event) => handlerRef.current(event));
	}, [chord, enabled, target.kind, scopeRef]);
}
