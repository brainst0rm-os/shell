/**
 * `useRegionNavigation` — installs the document-level F6 / Shift+F6 binder
 * for cross-region cycling within one window. Mirrors `61-keyboard-
 * accessibility.md §Tab order — the regions model`: each region exposes a
 * ref + label; F6 advances to the next region and focuses its ref, Shift+F6
 * retreats. Cleanup removes the listener so a route change doesn't strand
 * a stale binder.
 */

import { type RefObject, useEffect, useRef } from "react";
import type { RegionId } from "./region-id";
import { type RegionEntry, regionInit, regionNext, regionPrevious } from "./region-navigation";

export type UseRegionNavigationRegion = {
	readonly id: RegionId | string;
	readonly label: string;
	readonly ref: RefObject<HTMLElement | null>;
};

export type UseRegionNavigationOptions = {
	regions: ReadonlyArray<UseRegionNavigationRegion>;
	activeRegionId?: RegionId | string | null;
	onActiveRegionIdChange?: (id: string) => void;
	disabled?: boolean;
};

export function useRegionNavigation(options: UseRegionNavigationOptions): void {
	const regionsRef = useRef(options.regions);
	const activeRef = useRef<string | null>(options.activeRegionId ?? null);
	const onChangeRef = useRef(options.onActiveRegionIdChange);
	const disabled = options.disabled === true;

	useEffect(() => {
		regionsRef.current = options.regions;
	}, [options.regions]);

	useEffect(() => {
		activeRef.current = options.activeRegionId ?? null;
	}, [options.activeRegionId]);

	useEffect(() => {
		onChangeRef.current = options.onActiveRegionIdChange;
	}, [options.onActiveRegionIdChange]);

	useEffect(() => {
		if (disabled) return;
		if (typeof document === "undefined") return;

		const handler = (e: KeyboardEvent) => {
			if (e.key !== "F6") return;
			e.preventDefault();
			e.stopPropagation();
			const regions: ReadonlyArray<RegionEntry> = regionsRef.current.map((r) => ({
				id: r.id,
				label: r.label,
			}));
			if (regions.length === 0) return;
			// First F6 with no active region, OR a stale active id that has
			// been removed from `regions` (panel closed, route change), lands
			// on the first region (forward) or the last (backward). Without the
			// stillPresent check, regionInit falls back to regions[0] and
			// regionNext then advances to regions[1] — skipping the new first.
			const activeId = activeRef.current;
			const stillPresent = activeId !== null && regions.some((r) => r.id === activeId);
			let nextId: string | null;
			if (!stillPresent) {
				nextId = e.shiftKey
					? (regions[regions.length - 1] as RegionEntry).id
					: (regions[0] as RegionEntry).id;
			} else {
				const state = regionInit(regions, activeId);
				const next = e.shiftKey ? regionPrevious(state) : regionNext(state);
				nextId = next.activeRegionId;
			}
			if (nextId === null) return;
			activeRef.current = nextId;
			const region = regionsRef.current.find((r) => r.id === nextId);
			region?.ref.current?.focus();
			onChangeRef.current?.(nextId);
		};

		document.addEventListener("keydown", handler, true);
		return () => {
			document.removeEventListener("keydown", handler, true);
		};
	}, [disabled]);
}
