/**
 * Microtask-batched subscription store over an *async* resource with a
 * coarse invalidation signal — the entity-list / query counterpart to the
 * synchronous `createYStore` (which binds a single Yjs target).
 *
 * The vault exposes entity-list state as `VaultEntitiesService`: a
 * `list()` that resolves the authoritative snapshot and an `onChange`
 * staleness signal that fires on *any* write without saying which entity
 * changed (per `VaultEntitiesService` — "a bare staleness
 * signal; the app calls `list()` to fetch the authoritative snapshot").
 * Every app re-implemented the same dance around that signal — subscribe,
 * trailing-debounce the bursts, refetch, short-circuit when the snapshot
 * is structurally unchanged, cancel on teardown — each slightly
 * differently (the notes coalescer, the graph/db `scheduleVaultReload`,
 * the files fingerprint, the bookmarks `refreshFromRepo`). This is that
 * logic, once, framework-free, so `useLiveEntities` is a thin
 * `useSyncExternalStore` wrapper and imperative apps can drive the same
 * core with `subscribe`/`getSnapshot` while they migrate to React.
 *
 * `useSyncExternalStore` obligations and how we meet them:
 *   - `getSnapshot()` is referentially stable while nothing changed — the
 *     snapshot identity only advances when a freshly-loaded value differs
 *     under `equals`.
 *   - A burst of `onChange` signals (a transaction touching N entities)
 *     collapses to one reload via a trailing debounce.
 *   - Idle stores carry no source subscription — we ref-count listeners
 *     and bind/unbind the coarse signal lazily, exactly like `createYStore`.
 *
 * Stores are **read-only**; mutations flow through `entities.update`, never
 * back through here.
 */

export type QueryStore<T> = {
	/** Register a listener; returns an unsubscribe. The first subscriber
	 *  binds the coarse signal and kicks the initial load; the last
	 *  unsubscribe unbinds it. */
	subscribe(listener: () => void): () => void;
	/** Referentially-stable snapshot. Returns `initial` until the first
	 *  load resolves, then the latest value that differed under `equals`. */
	getSnapshot(): T;
	/** Reload now, bypassing the debounce; resolves once the snapshot has
	 *  been recomputed and listeners notified. Tests + an explicit
	 *  pull-to-refresh use this. A no-op (resolved) once disposed. */
	refresh(): Promise<void>;
	/** Drop the source subscription, cancel any pending reload, and ignore
	 *  further signals. */
	dispose(): void;
};

export type QueryStoreOptions<T> = {
	/** Fetch the authoritative snapshot (e.g. `() => repo.listAll()` or
	 *  `() => service.list()`). */
	load(): Promise<T>;
	/** Bind the coarse invalidation signal; return the unbind. Called on
	 *  the first subscriber, the returned unbind on the last unsubscribe.
	 *  A source without a change channel passes a binder that returns a
	 *  no-op — the store then only loads once (on first subscribe). */
	subscribe(onInvalidate: () => void): () => void;
	/** Synchronous value returned before the first load resolves. */
	initial: T;
	/** Whether a freshly-loaded snapshot differs from the cached one.
	 *  Defaults to `Object.is` — pass a structural comparator for list
	 *  snapshots (`shallowArrayEquals`, `vaultSnapshotEquals`) so an
	 *  equal-but-new array doesn't thrash React. */
	equals?: (a: T, b: T) => boolean;
	/** Trailing-debounce window (ms) collapsing a burst of signals into one
	 *  reload. Default 250 — the cadence every app converged on for batching
	 *  keystroke-driven saves. */
	coalesceMs?: number;
	/** Surfaced when `load()` rejects (transient worker `Unavailable`, say).
	 *  The cached snapshot is kept — a failed reload never blanks the UI. */
	onError?: (error: unknown) => void;
};

const DEFAULT_COALESCE_MS = 250;

export function createQueryStore<T>(options: QueryStoreOptions<T>): QueryStore<T> {
	const equals = options.equals ?? Object.is;
	const coalesceMs = options.coalesceMs ?? DEFAULT_COALESCE_MS;
	const listeners = new Set<() => void>();

	let snapshot = options.initial;
	let unbind: (() => void) | null = null;
	let disposed = false;
	let timer: ReturnType<typeof setTimeout> | null = null;
	// Monotonic token so an `onChange` burst that fires N reloads applies
	// only the newest result — an earlier-dispatched `list()` that resolves
	// late can't clobber a fresher snapshot.
	let loadSeq = 0;

	function notify(): void {
		for (const listener of [...listeners]) listener();
	}

	async function load(): Promise<void> {
		if (disposed) return;
		const mine = ++loadSeq;
		let next: T;
		try {
			next = await options.load();
		} catch (error) {
			options.onError?.(error);
			return;
		}
		// Superseded by a newer load, or disposed mid-flight → drop it.
		if (disposed || mine !== loadSeq) return;
		if (!equals(next, snapshot)) {
			snapshot = next;
			notify();
		}
	}

	function cancelTimer(): void {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
	}

	function scheduleReload(): void {
		if (disposed) return;
		// Trailing debounce: (re)arm a single timer so a burst collapses to one
		// reload `coalesceMs` after the LAST signal.
		cancelTimer();
		timer = setTimeout(() => {
			timer = null;
			void load();
		}, coalesceMs);
	}

	function bindIfNeeded(): void {
		if (unbind || disposed) return;
		unbind = options.subscribe(scheduleReload);
		// Kick the initial load now that someone is listening; the snapshot
		// stays `initial` until it resolves.
		void load();
	}

	function unbindIfIdle(): void {
		if (listeners.size > 0 || !unbind) return;
		unbind();
		unbind = null;
		cancelTimer();
	}

	return {
		subscribe(listener: () => void): () => void {
			// Revive a disposed store when a fresh subscriber arrives. React
			// StrictMode (dev) — and any unmount→remount of a store retained by
			// `useMemo` — runs the teardown effect (`dispose()`) on the simulated
			// unmount, then re-subscribes the SAME instance on remount. Without
			// revival the store would return a dead no-op here and stay pinned to
			// `initial` forever: the first mount's in-flight `load()` is dropped on
			// dispose, and the resubscribe never rebinds or reloads. A new
			// subscriber means the store is live again, so clear the flag and let
			// `bindIfNeeded` rebind the source + kick a fresh load. The `loadSeq`
			// guard makes the dropped first load harmless.
			if (disposed) disposed = false;
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
		refresh(): Promise<void> {
			cancelTimer();
			return load();
		},
		dispose(): void {
			if (disposed) return;
			disposed = true;
			cancelTimer();
			listeners.clear();
			if (unbind) {
				unbind();
				unbind = null;
			}
		},
	};
}

/** Length + per-index `Object.is` equality for list snapshots whose items
 *  are stable references (the common case when `load()` returns the same
 *  parsed objects). Cheap structural short-circuit for `equals`. */
export function shallowArrayEquals<T>(a: readonly T[], b: readonly T[]): boolean {
	if (a === b) return true;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (!Object.is(a[i], b[i])) return false;
	}
	return true;
}
