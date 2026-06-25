/**
 * `useDomChild` — mount a node produced by an imperative SDK factory
 * (`createEntityCoverElement` / `createEntityIconElement` / `createIconElement`)
 * into a React-managed host. The factory runs in an effect keyed by `deps`, so
 * the host's single child is rebuilt only when an input actually changes. Shared
 * by the card thumbnails and the detail surface (both wrap DOM-only SDK helpers).
 */

import { useEffect, useRef } from "react";

export function useDomChild(
	make: () => Node | null,
	deps: unknown[],
): (el: HTMLElement | null) => void {
	const ref = useRef<HTMLElement | null>(null);
	const makeRef = useRef(make);
	makeRef.current = make;
	useEffect(() => {
		const host = ref.current;
		if (!host) return;
		const child = makeRef.current();
		host.replaceChildren(...(child ? [child] : []));
	}, deps);
	return (el) => {
		ref.current = el;
	};
}
