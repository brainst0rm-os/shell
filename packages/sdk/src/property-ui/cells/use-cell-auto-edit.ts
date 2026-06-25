/**
 * `useCellAutoEdit` — run a cell's "begin editing" action in response to the
 * host's keyboard signal (the Database grid's Enter-to-edit, 12.4).
 *
 * Shared by every cell that reacts to Enter — the scalar inline editors
 * (Plain / Pill / Formatted / Multiline / Progress) `activate` by opening
 * their editor; the Boolean cells (Toggle / Checkbox) `activate` by flipping
 * the value. The rising-edge + ack contract lives here once, not per cell.
 *
 * Fires `activate()` then `onHandled?.()` exactly ONCE per rising edge of
 * `autoEdit` (read-only cells ignore it). The guard is a ref, not an effect
 * dependency, so the action fires once even if `autoEdit` stays latched across
 * re-renders — critical for `activate` callbacks that mutate (a Boolean toggle
 * would otherwise flip on every commit). `activate`/`onHandled` are read
 * through refs so an unstable caller callback can't re-trigger the effect.
 */

import { useEffect, useRef } from "react";

export function useCellAutoEdit(
	autoEdit: boolean | undefined,
	readOnly: boolean | undefined,
	activate: () => void,
	onHandled: (() => void) | undefined,
): void {
	const activateRef = useRef(activate);
	activateRef.current = activate;
	const onHandledRef = useRef(onHandled);
	onHandledRef.current = onHandled;
	const latched = useRef(false);

	// `activate`/`onHandled` are read through refs (above), so they're
	// intentionally not effect deps — the effect fires only on the `autoEdit`
	// rising edge, never on a callback-identity change.
	useEffect(() => {
		const rising = autoEdit === true && !latched.current;
		latched.current = autoEdit === true;
		if (!rising || readOnly) return;
		activateRef.current();
		onHandledRef.current?.();
	}, [autoEdit, readOnly]);
}
