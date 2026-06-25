/**
 * Microtask-coalesced subscription store over a Yjs target.
 *
 * This is the framework-free heart of the package — every hook is a thin
 * `useSyncExternalStore` wrapper over a `YStore` built here. Keeping the
 * batching + snapshot-stability logic out of React makes the CRDT
 * behaviour exhaustively unit-testable without a renderer (per CLAUDE.md
 * "CRDT code uses property tests").
 *
 * Contract obligations that `useSyncExternalStore` imposes, and how we
 * meet them:
 *   - `getSnapshot()` must return a referentially-stable value while
 *     nothing changed → we cache the snapshot and only recompute it when
 *     the underlying target actually fires a change.
 *   - Many synchronous Yjs mutations (a transaction touching N keys) must
 *     not cause N renders → we coalesce notifications into one per
 *  microtask (per §State management:
 *     "They batch updates per microtask to avoid thrash").
 *   - Idle docs shouldn't carry observers → we ref-count subscribers and
 *     bind/unbind the Yjs observer lazily.
 *
 * Hooks built on this are **read-only** by design; mutations flow through
 * the SDK's `entities.update`, not through these stores.
 */

export type YStore<T> = {
	/** Register a listener; returns an unsubscribe. First subscriber binds
	 *  the Yjs observer, last unsubscribe unbinds it. */
	subscribe(listener: () => void): () => void;
	/** Referentially-stable snapshot; identity only changes on real change
	 *  (subject to `equals`). Safe to call before/without subscribers. */
	getSnapshot(): T;
	/** Force the pending coalesced notification to run now. Tests + teardown
	 *  use this instead of awaiting a microtask. No-op when not dirty. */
	flush(): void;
	/** Drop the observer (if bound) and ignore further changes. */
	dispose(): void;
};

export type YStoreOptions<T> = {
	/** Attach the change observer; return the detach function. Called on
	 *  the first subscriber, the returned detach on the last unsubscribe. */
	bind(onChange: () => void): () => void;
	/** Compute the current snapshot from the Yjs target. */
	read(): T;
	/** Decide whether a freshly-`read()` snapshot differs from the cached
	 *  one. Defaults to `Object.is`. Use a structural comparator for
	 *  collection snapshots so equal-but-new objects don't thrash React. */
	equals?: (a: T, b: T) => boolean;
};

export function createYStore<T>(options: YStoreOptions<T>): YStore<T> {
	const equals = options.equals ?? Object.is;
	const listeners = new Set<() => void>();

	let snapshot = options.read();
	let unbind: (() => void) | null = null;
	let dirty = false;
	let microtaskQueued = false;
	let disposed = false;

	function recompute(): void {
		const next = options.read();
		if (!equals(next, snapshot)) {
			snapshot = next;
			for (const listener of [...listeners]) listener();
		}
	}

	function flush(): void {
		if (disposed || !dirty) return;
		dirty = false;
		recompute();
	}

	function onChange(): void {
		if (disposed) return;
		dirty = true;
		if (microtaskQueued) return;
		microtaskQueued = true;
		queueMicrotask(() => {
			microtaskQueued = false;
			flush();
		});
	}

	function bindIfNeeded(): void {
		if (unbind || disposed) return;
		unbind = options.bind(onChange);
		// State may have moved between store creation and the first mount;
		// resync so the first render sees current truth.
		recompute();
	}

	function unbindIfIdle(): void {
		if (listeners.size > 0 || !unbind) return;
		unbind();
		unbind = null;
	}

	return {
		subscribe(listener: () => void): () => void {
			if (disposed) return () => {};
			listeners.add(listener);
			bindIfNeeded();
			return () => {
				listeners.delete(listener);
				unbindIfIdle();
			};
		},
		getSnapshot(): T {
			return snapshot;
		},
		flush,
		dispose(): void {
			if (disposed) return;
			disposed = true;
			listeners.clear();
			if (unbind) {
				unbind();
				unbind = null;
			}
		},
	};
}

/** Shallow `ReadonlyMap` equality — used so a Y.Map snapshot rebuilt on
 *  every change is treated as unchanged when its entries are unchanged. */
export function shallowMapEquals<K, V>(a: ReadonlyMap<K, V>, b: ReadonlyMap<K, V>): boolean {
	if (a === b) return true;
	if (a.size !== b.size) return false;
	for (const [key, value] of a) {
		if (!b.has(key) || !Object.is(b.get(key), value)) return false;
	}
	return true;
}
