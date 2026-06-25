/**
 * Awareness adapter. Presence/cursor data is transported by the sync
 * layer's `Awareness` instance (`y-protocols/awareness`), which is *not*
 * a dependency of this package — pulling it in would couple the React
 * binding to the transport. Instead we depend on the minimal structural
 * shape we actually use; the real `Awareness` is assignable to it.
 *
 * Awareness state is session-scoped and never persisted (per
 * docs/editing/06-collaboration-yjs.md §Awareness).
 */

import { type YStore, createYStore } from "./subscription";

export type AwarenessState = Record<string, unknown>;

export interface AwarenessLike {
	readonly clientID: number;
	getLocalState(): AwarenessState | null;
	setLocalState(state: AwarenessState | null): void;
	setLocalStateField(field: string, value: unknown): void;
	getStates(): Map<number, AwarenessState>;
	on(event: "change", handler: () => void): void;
	off(event: "change", handler: () => void): void;
}

export type AwarenessSnapshot = {
	/** This device's client id. */
	clientID: number;
	/** This device's published state, or `null` when none is set. */
	local: AwarenessState | null;
	/** Every known device's state, keyed by client id (includes local). */
	states: ReadonlyMap<number, AwarenessState>;
};

function awarenessEquals(a: AwarenessSnapshot, b: AwarenessSnapshot): boolean {
	if (a === b) return true;
	if (a.clientID !== b.clientID || a.local !== b.local) return false;
	if (a.states.size !== b.states.size) return false;
	for (const [id, state] of a.states) {
		if (b.states.get(id) !== state) return false;
	}
	return true;
}

export function awarenessStore(awareness: AwarenessLike): YStore<AwarenessSnapshot> {
	return createYStore<AwarenessSnapshot>({
		bind: (onChange) => {
			awareness.on("change", onChange);
			return () => awareness.off("change", onChange);
		},
		read: () => ({
			clientID: awareness.clientID,
			local: awareness.getLocalState(),
			states: new Map(awareness.getStates()),
		}),
		equals: awarenessEquals,
	});
}
