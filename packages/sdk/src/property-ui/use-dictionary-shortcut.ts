/**
 * Document-level keydown shortcut gated on an injected matcher — the
 * subpath replacement for the Notes app's `useShortcut(id, handler)`.
 * The matcher comes from the host seams (Notes wires its chord
 * registry; the default is the bare key), so the DictionaryEditor's
 * close / focus-search shortcuts stay one source of truth with no raw
 * `e.key` outside `./seams`.
 *
 * Capture phase, mirroring the Notes hook, so it runs before any
 * contenteditable handlers and can `preventDefault()`.
 */

import { useEffect } from "react";
import type { KeyLike } from "./seams";

export function useDictionaryShortcut(
	matcher: (event: KeyLike) => boolean,
	handler: (event: KeyboardEvent) => void,
): void {
	useEffect(() => {
		function onKeydown(event: KeyboardEvent): void {
			if (matcher(event)) handler(event);
		}
		document.addEventListener("keydown", onKeydown, true);
		return () => document.removeEventListener("keydown", onKeydown, true);
	}, [matcher, handler]);
}
