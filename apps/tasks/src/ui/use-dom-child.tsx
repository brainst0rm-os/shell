/**
 * `useDomHost` — mount the node produced by an imperative DOM view-builder
 * (`renderSurfaceView` / `renderBoardView` / `renderTimelineView` /
 * `renderSearchView` / `renderSidebar` / `renderTaskDetailView`) into a
 * React-managed host. The builder runs in an effect keyed by `deps`, so the
 * host's single child is rebuilt only when an input actually changes.
 *
 * These builders are pure DOM factories (they wire their own composite
 * keyboard, HTML5 DnD, and delegated object menus on the returned subtree);
 * `apps/tasks/src/app.tsx` keeps the chrome + state + reactivity in React and
 * confines the imperative drawing behind this ref boundary, mirroring the
 * Bookmarks conversion's `useDomChild`.
 */

import { useEffect, useRef } from "react";

export function useDomHost(
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
