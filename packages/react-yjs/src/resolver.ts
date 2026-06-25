/**
 * `createYDocResolver` — the renderer-side Y.Doc replica resolver
 * (Stage 9.3.2). Pure + transport-injected so the refcount / echo-
 * suppression / async-load-into-synchronous-handle logic is exhaustively
 * testable without IPC or React (mirrors how 9.1's subscription core
 * landed before its consumers).
 *
 * Produces a `YDocResolver` compatible with `<YDocProvider>` (9.1): the
 * SDK preload builds a `YDocTransport` over the capability-gated
 * `entities` service (loadDoc/applyDoc/closeDoc) and injects
 * `resolver.resolve` at Stage 9.3.2b. Until then this core stands alone
 * and tested.
 *
 * Sync model (per — the IPC bridge
 * behaves like a Yjs `Provider`): the renderer holds a full replica
 * (OQ-9). `resolve()` is synchronous (the `<YDocProvider>` contract) so
 * it returns an empty `Y.Doc` immediately and hydrates it from the
 * canonical snapshot asynchronously — the 9.1 hooks re-render when the
 * snapshot lands. Local updates are shipped to the canonical side;
 * canonical-applied updates carry `REMOTE_ORIGIN` so the outbound
 * observer never echoes them back. Live inbound cross-window
 * convergence (`transport.onRemote`) is optional and wired at 9.3.2b.
 */

import * as Y from "yjs";
import type { YDocHandle, YDocResolver } from "./provider";

/** Origin tag for updates applied from the canonical side, so the
 *  outbound observer can distinguish them from local edits. */
export const REMOTE_ORIGIN = Symbol("brainstorm-ydoc-remote");

export type YDocTransport = {
	/** Fetch the entity's canonical snapshot (Yjs update bytes), or null
	 *  when the doc is empty / unavailable. */
	load(entityId: string): Promise<Uint8Array | null>;
	/** Ship a local update to the canonical side. Fire-and-forget — the
	 *  replica is authoritative for the renderer per OQ-9. */
	persist(entityId: string, update: Uint8Array): void;
	/** The last consumer for this entity unmounted — free the canonical
	 *  handle (refcounted by the worker). Must be idempotent. */
	release(entityId: string): void;
	/** Optional inbound: subscribe to canonical-side updates; returns an
	 *  unsubscribe. Absent in 9.3.2 (live cross-window convergence is
	 *  9.3.2b — needs a worker→renderer broadcast). */
	onRemote?(entityId: string, apply: (update: Uint8Array) => void): () => void;
};

export type YDocResolverApi = {
	/** Synchronous, refcounted resolver for `<YDocProvider resolver=…>`. */
	resolve: YDocResolver;
	/** Resolves once the entity's snapshot has been applied (or there was
	 *  none). Used by `getYFragment` / `getYText` which must hand back a
	 *  hydrated fragment. Unknown entity → already-resolved. */
	whenLoaded(entityId: string): Promise<void>;
	/** Detach every replica + observer (renderer teardown). */
	dispose(): void;
};

export type YDocResolverOptions = {
	/** How many zero-ref replicas to keep live for instant reopen.
	 *
	 *  Apps remount the editor on every navigation (`key={entityId}`), so
	 *  navigating from a note to a sub-page and back releases then
	 *  re-resolves the same entity within a few hundred ms. Destroying the
	 *  replica on the first release is wrong for that flow on two counts:
	 *
	 *   1. Reopen builds a FRESH empty doc and re-applies the snapshot
	 *      asynchronously. The apply can land before — or be observed by a
	 *      binding that registers after — the editor's `observeDeep`, so the
	 *      editor renders blank even though the bytes are on disk (the
	 *      `tests/perf/specs/repro-note-loss.spec.ts` race).
	 *   2. `release()` fires `transport.release()` (→ `closeDoc`) right
	 *      behind a just-shipped fire-and-forget `persist()` (→ `applyDoc`).
	 *      Closing the canonical handle while that write is in flight risks
	 *      dropping the update (the "sub-page link vanishes after reload"
	 *      report).
	 *
	 *  Retaining the released replica's STATE (not the instance — see
	 *  `resolve`) makes reopen seed a fresh doc from memory (instant, no
	 *  IPC reload) and defers `closeDoc` until the entity is genuinely cold
	 *  (evicted past the cap). `0` restores the legacy destroy-on-last-
	 *  release behaviour. */
	retentionCap?: number;
	/** Surfaces a snapshot load/apply failure for an entity. The resolver
	 *  recovers either way — the replica is left empty and local edits still
	 *  ship — but without this hook the failure is invisible: a corrupt or
	 *  unreachable snapshot looks identical to an empty doc. Wire it to a
	 *  logger (and, ideally, a UI affordance) so a doc that silently failed
	 *  to load is distinguishable from a genuinely empty one. */
	onError?(entityId: string, error: unknown): void;
};

/** Default zero-ref retention. Bounds memory (each retained replica holds a
 *  full Y.Doc) while comfortably covering navigate-away-and-back plus a
 *  handful of recently-visited docs. */
export const DEFAULT_RETENTION_CAP = 16;

type Entry = {
	doc: Y.Doc;
	refs: number;
	loaded: Promise<void>;
	/** Trigger the snapshot apply NOW. Idempotent — subsequent calls return
	 *  the same `loaded` promise. The editor calls this from inside its
	 *  `LocalProvider.connect()`, which `@lexical/react`'s
	 *  `CollaborationPlugin` invokes AFTER it registers the binding's
	 *  `observeDeep`. Applying earlier (when the IPC roundtrip finishes,
	 *  which can land before React mounts the editor) fires the Yjs
	 *  update events into a doc no observer is listening on — Lexical's
	 *  collabNodeMap stays empty, the editor renders blank on reopen
	 *  even though Yjs has the content. See
	 *  `tests/perf/specs/repro-note-loss.spec.ts` for the regression. */
	applyPending: () => Promise<void>;
	/** True once `applyPending()` has completed — the snapshot is in `doc`
	 *  (or there was none). Revive may only seed a fresh replica from this
	 *  one's in-memory state when this holds; otherwise the replica was
	 *  released before it ever hydrated and is still empty, so the canonical
	 *  snapshot must be re-loaded from disk instead. */
	hasApplied: () => boolean;
	detach: () => void;
};

export function createYDocResolver(
	transport: YDocTransport,
	options: YDocResolverOptions = {},
): YDocResolverApi {
	const retentionCap = options.retentionCap ?? DEFAULT_RETENTION_CAP;
	const reportError = options.onError ?? (() => {});
	const entries = new Map<string, Entry>();
	// Zero-ref entries kept live for instant reopen, in least-recently-
	// released order (insertion order = LRU; re-resolving deletes the key so
	// a later re-release re-appends it as most-recent). Eviction past the cap
	// is the ONLY place a retained replica is torn down.
	const retained = new Map<string, Entry>();
	let disposed = false;

	function tearDown(entityId: string, entry: Entry): void {
		entry.detach();
		transport.release(entityId);
	}

	function evictRetainedOverCap(): void {
		while (retained.size > retentionCap) {
			const oldest = retained.keys().next().value;
			if (oldest === undefined) break;
			const victim = retained.get(oldest);
			retained.delete(oldest);
			if (victim) tearDown(oldest, victim);
		}
	}

	function open(entityId: string, seedState?: Uint8Array): Entry {
		const doc = new Y.Doc();

		const onUpdate = (update: Uint8Array, origin: unknown): void => {
			if (origin === REMOTE_ORIGIN) return; // canonical-applied — don't echo
			transport.persist(entityId, update);
		};
		doc.on("update", onUpdate);

		const offRemote = transport.onRemote?.(entityId, (update) => {
			Y.applyUpdate(doc, update, REMOTE_ORIGIN);
		});

		// Revival seeds the snapshot from the just-released replica's
		// in-memory state instead of re-loading over IPC (instant, and the
		// canonical handle was never closed). The bytes still flow through the
		// SAME lazy `applyPending` path as a disk load, so they land AFTER the
		// editor binding's `observeDeep` — a fresh doc fires the Yjs events
		// that populate Lexical. Reusing the retained doc *instance* instead
		// would leave a fresh binding observing an already-populated doc that
		// emits no events → blank editor (the navigate-back regression).
		const loadedBytes: Promise<Uint8Array | null> =
			seedState !== undefined
				? Promise.resolve(seedState)
				: transport.load(entityId).catch((err) => {
						reportError(entityId, err);
						return null;
					});

		// Lazy apply: hold the snapshot until `applyPending()` is called from
		// inside the editor's binding wiring (see Entry.applyPending docs
		// above for the race this guards against). `loaded` is the public
		// "snapshot is in the doc" gate; it resolves the first time
		// applyPending() completes. The resolver-level `whenLoaded(entityId)`
		// accessor (below) triggers `applyPending()` on the entry so
		// non-editor callers (the Notes body-migration scan) don't have to
		// know about the dual API.
		// `loaded` is a deferred — it resolves the first time `applyPending()`
		// runs (whoever triggers the apply: the editor's LocalProvider,
		// the resolver-level `whenLoaded(id)` accessor for non-editor
		// callers, etc.). Awaiting `loaded` BEFORE anyone triggers apply
		// blocks indefinitely — by design — so a missing editor binding is
		// detectable as a hang rather than silently rendering blank.
		let resolveLoaded: () => void = () => {};
		const loaded = new Promise<void>((res) => {
			resolveLoaded = res;
		});
		let applyPromise: Promise<void> | null = null;
		let applied = false;
		const applyPending = (): Promise<void> => {
			if (applyPromise) return applyPromise;
			applyPromise = (async () => {
				try {
					const snapshot = await loadedBytes;
					if (snapshot && snapshot.length > 0) Y.applyUpdate(doc, snapshot, REMOTE_ORIGIN);
				} catch (err) {
					// A corrupt / half-written snapshot must not strand the
					// editor: `Y.applyUpdate` throwing here previously left
					// `loaded` unsettled forever (the LocalProvider awaits it)
					// and cached a rejected `applyPromise` so retries couldn't
					// recover. Report it and fall through — the replica stays
					// empty but live, so local edits still ship and the user
					// can keep working rather than facing a frozen surface.
					reportError(entityId, err);
				} finally {
					applied = true;
					resolveLoaded();
				}
			})();
			return applyPromise;
		};

		return {
			doc,
			refs: 0,
			loaded,
			applyPending,
			hasApplied: () => applied,
			detach: () => {
				doc.off("update", onUpdate);
				offRemote?.();
				doc.destroy();
			},
		};
	}

	const resolve: YDocResolver = (entityId: string): YDocHandle => {
		let entry = entries.get(entityId);
		if (!entry) {
			// Revive from a retained replica when one is live: seed a fresh doc
			// from its in-memory state (no IPC reload, canonical never closed)
			// and discard the old instance. A fresh doc is required so the new
			// editor binding's `observeDeep` receives the seed as Yjs events —
			// reusing the populated instance directly renders blank.
			const kept = retained.get(entityId);
			if (kept) {
				retained.delete(entityId);
				// Only seed from the retained replica's in-memory state when it
				// actually hydrated. A replica released before its `applyPending()`
				// ran is still EMPTY — seeding from it (and skipping the disk load,
				// as `open(seed)` does) would render a blank doc and never re-read
				// the canonical snapshot. In that case fall back to a normal open
				// so `transport.load` runs.
				const seed = kept.hasApplied() ? Y.encodeStateAsUpdate(kept.doc) : undefined;
				kept.detach(); // destroy the old replica WITHOUT closing canonical
				entry = open(entityId, seed);
			} else {
				entry = open(entityId);
			}
			entries.set(entityId, entry);
		}
		entry.refs += 1;

		let released = false;
		const entryRef = entry;
		return {
			doc: entry.doc,
			loaded: entry.loaded,
			applyPending: () => entryRef.applyPending(),
			release: () => {
				if (released) return; // per-handle idempotent
				released = true;
				const current = entries.get(entityId);
				if (!current) return;
				current.refs -= 1;
				if (current.refs > 0) return;
				entries.delete(entityId);
				if (retentionCap <= 0) {
					tearDown(entityId, current);
					return;
				}
				// Keep the live, already-observed replica for instant reopen.
				// `transport.release()` (→ closeDoc) is deferred until eviction
				// so it can't race a just-shipped persist on navigate-away.
				retained.set(entityId, current);
				evictRetainedOverCap();
			},
		};
	};

	return {
		resolve,
		// External-caller convenience: triggers the apply AND waits for it.
		// Used by migration paths that don't go through the editor's
		// LocalProvider (which has its own apply trigger inside connect()).
		whenLoaded: (entityId: string) => {
			const entry = entries.get(entityId) ?? retained.get(entityId);
			if (!entry) return Promise.resolve();
			return entry.applyPending();
		},
		dispose: () => {
			if (disposed) return;
			disposed = true;
			for (const [id, entry] of entries) tearDown(id, entry);
			entries.clear();
			for (const [id, entry] of retained) tearDown(id, entry);
			retained.clear();
		},
	};
}
