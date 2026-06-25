/**
 * Renderer-side adapter over the `bin:*` IPC surface (Stage 9.19).
 * Mirrors `useMarketplace` — declarative data hook keeping the Bin
 * components React-friendly.
 *
 * Re-pulls on every dashboard snapshot push: the shell republishes the
 * dashboard whenever an entity is created / updated / deleted / restored
 * (and the Bin handlers fire the same fan-out), so a freshly-deleted or
 * just-restored object appears / disappears here with no own pub/sub
 * channel.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { BinItem } from "../../preload/bin-types";

export type BinState = {
	items: BinItem[] | null;
	loading: boolean;
	refresh: () => void;
	restore: (id: string) => Promise<boolean>;
	purge: (id: string) => Promise<boolean>;
	restoreMany: (ids: readonly string[]) => Promise<number>;
	purgeMany: (ids: readonly string[]) => Promise<number>;
	empty: () => Promise<number>;
};

export function useBin(): BinState {
	const [items, setItems] = useState<BinItem[] | null>(null);
	const cancelledRef = useRef(false);

	const fetchAll = useCallback(() => {
		void window.brainstorm.bin.list().then((next) => {
			if (cancelledRef.current) return;
			setItems(next);
		});
	}, []);

	useEffect(() => {
		cancelledRef.current = false;
		fetchAll();
		return () => {
			cancelledRef.current = true;
		};
	}, [fetchAll]);

	useEffect(() => {
		return window.brainstorm.dashboard.on(() => {
			fetchAll();
		});
	}, [fetchAll]);

	const restore = useCallback(
		async (id: string) => {
			const ok = await window.brainstorm.bin.restore(id);
			if (ok) fetchAll();
			return ok;
		},
		[fetchAll],
	);

	const purge = useCallback(
		async (id: string) => {
			const ok = await window.brainstorm.bin.purge(id);
			if (ok) fetchAll();
			return ok;
		},
		[fetchAll],
	);

	// Batch restore / purge reuse the single-item IPC per id (no batch verb on
	// the `bin:*` surface), but refresh the list once at the end rather than per
	// id, so a multi-select action triggers a single re-render. Returns the count
	// that actually succeeded.
	const restoreMany = useCallback(
		async (ids: readonly string[]) => {
			let restored = 0;
			for (const id of ids) {
				if (await window.brainstorm.bin.restore(id)) restored += 1;
			}
			if (restored > 0) fetchAll();
			return restored;
		},
		[fetchAll],
	);

	const purgeMany = useCallback(
		async (ids: readonly string[]) => {
			let purged = 0;
			for (const id of ids) {
				if (await window.brainstorm.bin.purge(id)) purged += 1;
			}
			if (purged > 0) fetchAll();
			return purged;
		},
		[fetchAll],
	);

	const empty = useCallback(async () => {
		const count = await window.brainstorm.bin.empty();
		if (count > 0) fetchAll();
		return count;
	}, [fetchAll]);

	return {
		items,
		loading: items === null,
		refresh: fetchAll,
		restore,
		purge,
		restoreMany,
		purgeMany,
		empty,
	};
}
