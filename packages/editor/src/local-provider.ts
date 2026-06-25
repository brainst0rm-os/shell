/**
 * A no-transport `@lexical/yjs` provider over an already-resolved Y.Doc.
 *
 * Brainstorm Lexical is *always* Yjs-backed (docs/editing/07-editing-lexical.md
 * §Decision: no non-collaborative mode) — even a local-only edit goes
 * through the CRDT so turning sync on later is a pure transport addition.
 * This provider satisfies `@lexical/yjs`'s `Provider` contract without a
 * network: it owns an `Awareness`, and emits a single `sync(true)` so the
 * CollaborationPlugin bootstraps the editor from (or into) the doc. The
 * real networked provider is a Stage 10 transport swap — the binding here
 * is unchanged.
 */

import type { Provider } from "@lexical/yjs";
import { Awareness } from "y-protocols/awareness";
import type { Doc } from "yjs";

type Listener = (...args: unknown[]) => void;

export function createLocalProvider(
	doc: Doc,
	opts?: { whenLoaded?: Promise<void>; applyPending?: () => Promise<void> },
): Provider {
	const awareness = new Awareness(doc);
	const listeners = new Map<string, Set<Listener>>();

	function emit(type: string, ...args: unknown[]): void {
		const set = listeners.get(type);
		if (set) for (const cb of [...set]) cb(...args);
	}

	return {
		awareness,
		connect() {
			// Trigger the canonical snapshot apply HERE — `connect()` is
			// called by `@lexical/react`'s `CollaborationPlugin` AFTER it
			// has registered the binding's `observeDeep`. Applying earlier
			// (e.g. eagerly off the resolver's load promise) fires the Yjs
			// update events into a doc whose binding isn't yet listening,
			// so Lexical's `collabNodeMap` stays empty and the editor
			// renders blank on reopen even though Yjs has the content.
			// Regression repro: `tests/perf/specs/repro-note-loss.spec.ts`.
			const fire = () => {
				emit("sync", true);
			};
			// Always fire `sync` even on load failure — a failed load leaves
			// an empty replica that the seeder + future user edits will
			// still need to operate on.
			if (opts?.applyPending) {
				opts.applyPending().then(fire, fire);
			} else if (opts?.whenLoaded) {
				opts.whenLoaded.then(fire, fire);
			} else {
				queueMicrotask(fire);
			}
		},
		disconnect() {
			awareness.destroy();
		},
		on(type: string, cb: Listener) {
			let set = listeners.get(type);
			if (!set) {
				set = new Set();
				listeners.set(type, set);
			}
			set.add(cb);
		},
		off(type: string, cb: Listener) {
			listeners.get(type)?.delete(cb);
		},
		// y-protocols' `Awareness` structurally satisfies `ProviderAwareness`
		// but TS's overload-shaped `on`/`off` don't unify cleanly — the
		// double cast is the established @lexical/yjs local-provider pattern.
	} as unknown as Provider;
}
