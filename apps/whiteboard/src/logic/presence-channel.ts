/**
 * Local presence channel (9.17.19) — a minimal in-process implementation of
 * `@brainstorm/react-yjs`'s structural `AwarenessLike`, used until the
 * Stage-10 transport hands the app a real `y-protocols/awareness`
 * instance. A real `Awareness` is assignable to the same interface, so the
 * swap is constructor-deep: nothing downstream (publisher, peers
 * derivation, overlay) changes.
 *
 * Deliberately NOT the y-protocols implementation: the app sandbox has no
 * wire to speak the awareness protocol over yet, and pulling `yjs` +
 * `y-protocols` into the whiteboard bundle for a session-local map would
 * be pure weight. The dev hook (`__brainstormWhiteboardDev.presence`)
 * feeds remote states through `applyRemoteState`, which is exactly what
 * the future inbound-transport adapter will call.
 */

import type { AwarenessLike, AwarenessState } from "@brainstorm/react-yjs";

export type LocalAwareness = AwarenessLike & {
	/** Inbound path for remote peer states (the transport adapter / dev
	 *  hook). `null` removes the peer (the y-protocols dispose convention). */
	applyRemoteState(clientId: number, state: AwarenessState | null): void;
	/** Drop every listener + remote state (engine dispose). */
	destroy(): void;
};

/** A session-unique client id: 32-bit random, mirroring Yjs's clientID. */
export function randomClientId(): number {
	return Math.floor(Math.random() * 0xffffffff);
}

export function createLocalAwareness(clientID: number = randomClientId()): LocalAwareness {
	const states = new Map<number, AwarenessState>();
	const listeners = new Set<() => void>();

	function emit(): void {
		for (const listener of [...listeners]) listener();
	}

	return {
		clientID,
		getLocalState() {
			return states.get(clientID) ?? null;
		},
		setLocalState(state) {
			if (state === null) states.delete(clientID);
			else states.set(clientID, state);
			emit();
		},
		setLocalStateField(field, value) {
			const next = { ...(states.get(clientID) ?? {}), [field]: value };
			states.set(clientID, next);
			emit();
		},
		getStates() {
			return new Map(states);
		},
		on(event, handler) {
			if (event === "change") listeners.add(handler);
		},
		off(event, handler) {
			if (event === "change") listeners.delete(handler);
		},
		applyRemoteState(clientId, state) {
			if (clientId === clientID) return;
			if (state === null) states.delete(clientId);
			else states.set(clientId, state);
			emit();
		},
		destroy() {
			states.clear();
			listeners.clear();
		},
	};
}
