/**
 * Stage 10.6 — sender-side awareness wrapper.
 *
 * Owns per-entity pointers into the renderer's / app-host's `Awareness`
 * instances (from `y-protocols/awareness`), subscribes to their `update`
 * events, batches outbound emission with a per-entity trailing debouncer
 * (OQ-204 → 50 ms), maintains a per-entity heartbeat interval
 * (`outdatedTimeout / 2` ≈ 15 s) so peers don't time us out as stale, and
 * routes inbound updates back to the right `Awareness` via
 * `applyAwarenessUpdate`.
 *
 * **OQ-204 invariants** (load-bearing):
 *   - Debounce happens at the EMITTER, not inside `setLocalState`. Local
 *     `Awareness` always reflects the latest local cursor immediately;
 *     only the outbound envelope is rate-limited. Throttling
 *     `setLocalState` would break Yjs's clock invariant (the clock advances
 *     monotonically on every call; skipping one drops a tick).
 *   - The heartbeat re-sends the **current** local state under the local
 *     clientID at ~15 s cadence. Peers refresh their `lastUpdated` and
 *     don't garbage-collect us at `outdatedTimeout = 30 s`.
 *   - Inbound `applyAwarenessUpdate` is the y-protocols entry point that
 *     implements the clock dedup; we don't second-guess it.
 *
 * **OQ-205 invariants:**
 *   - No new default-grant capability. Awareness piggybacks on
 *     `entities.read:<type>` — if an app already has the entity bytes,
 *     it can see awareness for the same entity. The broadcaster is
 *     shell-internal; apps see awareness via the existing entity-read
 *     path (the broadcaster's `awarenessByEntity` getter returns the
 *     same instances the renderer's editor binding already holds).
 *
 * **DEK-missing graceful degradation:** if the outbound `emitAwareness`
 * rejects with `Unavailable` (the entity has no DEK locally — possible
 * during a 10.x retro-wrap miss), the broadcaster logs + drops. Local
 * awareness still updates; we just can't share it until the DEK lands.
 */

import { applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import type { Awareness } from "y-protocols/awareness";
import type { PipelineContext } from "./envelope-pipeline";
import { emitAwareness } from "./envelope-pipeline";

/** OQ-204 — 50 ms trailing debounce on outbound awareness emission. */
export const AWARENESS_DEBOUNCE_MS = 50;
/** OQ-204 — heartbeat cadence. Matches `y-protocols`' `outdatedTimeout / 2`. */
export const AWARENESS_HEARTBEAT_MS = 15_000;

export type AwarenessByEntityGetter = () => Map<string, Awareness>;

export type AwarenessBroadcasterOptions = {
	pipeline: PipelineContext;
	awarenessByEntity: AwarenessByEntityGetter;
	/** Optional override for tests; defaults to `() => Date.now()`. */
	nowMs?: () => number;
	/**
	 * Optional override for the emit primitive. Default is the production
	 * `emitAwareness(entityId, update, pipeline)` from `./envelope-pipeline`.
	 * Tests inject a spy so the broadcaster's batching contract can be
	 * asserted without spinning a full relay + DEK store.
	 */
	emit?: (entityId: string, awarenessUpdate: Uint8Array) => Promise<void>;
	/**
	 * Sink for non-fatal emit errors (DEK missing, transport closed). The
	 * default writes to `console.warn`. Awareness loss is non-fatal — local
	 * cursors keep rendering and peers fall through to "we don't know where
	 * this device is" rather than crashing the app.
	 */
	onEmitError?: (error: unknown, entityId: string) => void;
};

type Pending = {
	clientIds: Set<number>;
	timer: ReturnType<typeof setTimeout> | null;
};

type TrackedEntity = {
	awareness: Awareness;
	updateHandler: (
		event: { added: number[]; updated: number[]; removed: number[] },
		origin: unknown,
	) => void;
	heartbeat: ReturnType<typeof setInterval> | null;
	pending: Pending;
};

export class AwarenessBroadcaster {
	readonly #pipeline: PipelineContext;
	readonly #awarenessByEntity: AwarenessByEntityGetter;
	readonly #nowMs: () => number;
	readonly #emit: (entityId: string, awarenessUpdate: Uint8Array) => Promise<void>;
	readonly #onEmitError: (error: unknown, entityId: string) => void;
	readonly #tracked = new Map<string, TrackedEntity>();
	#disposed = false;

	constructor(opts: AwarenessBroadcasterOptions) {
		this.#pipeline = opts.pipeline;
		this.#awarenessByEntity = opts.awarenessByEntity;
		this.#nowMs = opts.nowMs ?? (() => Date.now());
		this.#emit = opts.emit ?? ((entityId, update) => emitAwareness(entityId, update, this.#pipeline));
		this.#onEmitError =
			opts.onEmitError ??
			((error, entityId) => {
				console.warn(`[awareness] emit dropped for ${entityId}:`, error);
			});
	}

	/**
	 * Subscribe to a per-entity `Awareness` instance. Wires the `update`
	 * listener + arms the heartbeat. Idempotent on `(entityId, awareness)`
	 * pairs — re-tracking the *same* `Awareness` is a no-op; re-tracking
	 * with a *different* `Awareness` cleanly untracks the old one first.
	 */
	track(entityId: string, awareness: Awareness): void {
		if (this.#disposed) return;
		const existing = this.#tracked.get(entityId);
		if (existing) {
			if (existing.awareness === awareness) return;
			this.#detach(entityId, existing);
		}
		const pending: Pending = { clientIds: new Set(), timer: null };
		const updateHandler = (
			event: { added: number[]; updated: number[]; removed: number[] },
			origin: unknown,
		): void => {
			if (origin === RemoteOrigin) return;
			for (const id of event.added) pending.clientIds.add(id);
			for (const id of event.updated) pending.clientIds.add(id);
			for (const id of event.removed) pending.clientIds.add(id);
			this.#schedule(entityId);
		};
		awareness.on("update", updateHandler);
		const heartbeat = setInterval(() => {
			this.#emitHeartbeat(entityId);
		}, AWARENESS_HEARTBEAT_MS);
		this.#tracked.set(entityId, {
			awareness,
			updateHandler,
			heartbeat,
			pending,
		});
	}

	/**
	 * Stop tracking an entity. Broadcasts a final `state=null` for our
	 * local clientID so peers cleanly drop our presence (instead of
	 * waiting `outdatedTimeout` to time us out).
	 */
	untrack(entityId: string): void {
		const tracked = this.#tracked.get(entityId);
		if (!tracked) return;
		this.#detach(entityId, tracked);
		this.#emitDisposeNull(entityId, tracked.awareness);
	}

	/**
	 * Apply an inbound awareness update to the right `Awareness` instance.
	 * Looks up the entity in the live `awarenessByEntity` map (which may
	 * have changed since the broadcaster started — entity docs come and
	 * go); if absent, drops with no error (the entity isn't open locally,
	 * so there's no UI surface to update).
	 */
	applyInbound(awarenessUpdate: Uint8Array, entityId: string): void {
		if (this.#disposed) return;
		const map = this.#awarenessByEntity();
		const awareness = map.get(entityId);
		if (!awareness) return;
		applyAwarenessUpdate(awareness, awarenessUpdate, RemoteOrigin);
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		for (const [entityId, tracked] of this.#tracked) {
			this.#detach(entityId, tracked);
			this.#emitDisposeNull(entityId, tracked.awareness);
		}
		this.#tracked.clear();
	}

	#schedule(entityId: string): void {
		if (this.#disposed) return;
		const tracked = this.#tracked.get(entityId);
		if (!tracked) return;
		if (tracked.pending.timer !== null) {
			clearTimeout(tracked.pending.timer);
		}
		tracked.pending.timer = setTimeout(() => {
			this.#flushPending(entityId);
		}, AWARENESS_DEBOUNCE_MS);
	}

	#flushPending(entityId: string): void {
		const tracked = this.#tracked.get(entityId);
		if (!tracked) return;
		tracked.pending.timer = null;
		const clientIds = [...tracked.pending.clientIds];
		tracked.pending.clientIds.clear();
		if (clientIds.length === 0) return;
		let update: Uint8Array;
		try {
			update = encodeAwarenessUpdate(tracked.awareness, clientIds);
		} catch (error) {
			this.#onEmitError(error, entityId);
			return;
		}
		this.#emit(entityId, update).catch((error) => {
			this.#onEmitError(error, entityId);
		});
	}

	#emitHeartbeat(entityId: string): void {
		const tracked = this.#tracked.get(entityId);
		if (!tracked) return;
		const localId = tracked.awareness.clientID;
		if (!tracked.awareness.states.has(localId)) return;
		let update: Uint8Array;
		try {
			update = encodeAwarenessUpdate(tracked.awareness, [localId]);
		} catch (error) {
			this.#onEmitError(error, entityId);
			return;
		}
		this.#emit(entityId, update).catch((error) => {
			this.#onEmitError(error, entityId);
		});
	}

	#emitDisposeNull(entityId: string, awareness: Awareness): void {
		const localId = awareness.clientID;
		const meta = awareness.meta.get(localId);
		const nextClock = (meta?.clock ?? 0) + 1;
		awareness.meta.set(localId, { clock: nextClock, lastUpdated: this.#nowMs() });
		const tempStates = new Map<number, Record<string, unknown>>();
		let update: Uint8Array;
		try {
			update = encodeAwarenessUpdate(awareness, [localId], tempStates);
		} catch (error) {
			this.#onEmitError(error, entityId);
			return;
		}
		this.#emit(entityId, update).catch((error) => {
			this.#onEmitError(error, entityId);
		});
	}

	#detach(entityId: string, tracked: TrackedEntity): void {
		tracked.awareness.off("update", tracked.updateHandler);
		if (tracked.heartbeat !== null) clearInterval(tracked.heartbeat);
		if (tracked.pending.timer !== null) {
			clearTimeout(tracked.pending.timer);
			tracked.pending.timer = null;
		}
		tracked.pending.clientIds.clear();
		this.#tracked.delete(entityId);
	}
}

/**
 * Origin marker for `applyAwarenessUpdate` calls so our own `update`
 * listener doesn't re-broadcast received frames in a tight loop. Yjs
 * passes the origin straight through to listeners as the second arg of
 * the `update` event; matching by reference identity is robust against
 * string-typo bugs.
 */
const RemoteOrigin: unique symbol = Symbol("awareness-remote");
