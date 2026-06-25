/**
 * Subscribe to the vault-level properties + dictionaries snapshot
 * stream (VP-4). The main process loads the YDoc on first call to
 * `window.brainstorm.properties.snapshot()` and re-broadcasts every
 * committed update on the `properties:snapshot` IPC channel. This hook
 * is a thin React adapter — same shape as `useDashboard`.
 *
 * Returns `null` until the first snapshot arrives (typically one tick
 * after mount). After that, every store mutation — local or from a
 * future sync peer — refreshes the snapshot reference.
 */

import { useEffect, useState } from "react";
import type { PropertiesSnapshot } from "../../preload";

export function usePropertiesSnapshot(): PropertiesSnapshot | null {
	const [snapshot, setSnapshot] = useState<PropertiesSnapshot | null>(null);

	useEffect(() => {
		let cancelled = false;
		void window.brainstorm.properties.snapshot().then((snap) => {
			if (!cancelled && snap) setSnapshot(snap);
		});
		const unsubscribe = window.brainstorm.properties.on((snap) => {
			setSnapshot(snap);
		});
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, []);

	return snapshot;
}
