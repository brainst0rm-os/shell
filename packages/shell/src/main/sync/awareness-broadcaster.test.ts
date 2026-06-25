/**
 * Stage 10.6 — `AwarenessBroadcaster` unit tests.
 *
 * Exercises the OQ-204 contract: trailing debounce, per-entity isolation,
 * heartbeat cadence, inbound-apply origin-marker (no re-broadcast loop),
 * dispose null-broadcast, DEK-missing graceful degradation, and
 * untrack-then-retrack listener cleanup.
 *
 * The broadcaster's `emit` is injected in every test so the contract is
 * asserted as "what gets to the pipeline" — independent of the relay,
 * DEK store, and seal/open layers.
 */

import { describe, expect, it, vi } from "vitest";
import { Awareness, applyAwarenessUpdate } from "y-protocols/awareness";
import { Doc } from "yjs";
import {
	AWARENESS_DEBOUNCE_MS,
	AWARENESS_HEARTBEAT_MS,
	AwarenessBroadcaster,
} from "./awareness-broadcaster";
import type { PipelineContext } from "./envelope-pipeline";

const stubPipeline = {} as PipelineContext;

function makeBroadcaster(
	opts: {
		awareness?: Map<string, Awareness>;
		onEmitError?: (error: unknown, entityId: string) => void;
		emit?: (entityId: string, awarenessUpdate: Uint8Array) => Promise<void>;
	} = {},
) {
	const map = opts.awareness ?? new Map<string, Awareness>();
	const calls: Array<{ entityId: string; update: Uint8Array }> = [];
	const emit =
		opts.emit ??
		vi.fn(async (entityId: string, update: Uint8Array) => {
			calls.push({ entityId, update });
		});
	const broadcaster = new AwarenessBroadcaster({
		pipeline: stubPipeline,
		awarenessByEntity: () => map,
		emit,
		...(opts.onEmitError !== undefined ? { onEmitError: opts.onEmitError } : {}),
	});
	return { broadcaster, awarenessByEntity: map, emit, calls };
}

function makeAwareness(): { doc: Doc; awareness: Awareness } {
	const doc = new Doc();
	const awareness = new Awareness(doc);
	return { doc, awareness };
}

describe("AwarenessBroadcaster", () => {
	it("multiple setLocalState() within the debounce window batch into one envelope", async () => {
		vi.useFakeTimers();
		try {
			const { broadcaster, awarenessByEntity, emit } = makeBroadcaster();
			const { awareness } = makeAwareness();
			awarenessByEntity.set("ent_a", awareness);
			broadcaster.track("ent_a", awareness);

			awareness.setLocalState({ cursor: 1 });
			awareness.setLocalState({ cursor: 2 });
			awareness.setLocalState({ cursor: 3 });
			expect(emit).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(AWARENESS_DEBOUNCE_MS);
			expect(emit).toHaveBeenCalledTimes(1);

			broadcaster.dispose();
		} finally {
			vi.useRealTimers();
		}
	});

	it("distinct entities maintain separate debounce timers", async () => {
		vi.useFakeTimers();
		try {
			const { broadcaster, awarenessByEntity, emit } = makeBroadcaster();
			const a = makeAwareness();
			const b = makeAwareness();
			awarenessByEntity.set("ent_a", a.awareness);
			awarenessByEntity.set("ent_b", b.awareness);
			broadcaster.track("ent_a", a.awareness);
			broadcaster.track("ent_b", b.awareness);

			a.awareness.setLocalState({ cursor: 1 });
			b.awareness.setLocalState({ cursor: 2 });
			await vi.advanceTimersByTimeAsync(AWARENESS_DEBOUNCE_MS);

			expect(emit).toHaveBeenCalledTimes(2);
			const entityIds = (emit as ReturnType<typeof vi.fn>).mock.calls
				.map((call: unknown[]) => call[0])
				.sort();
			expect(entityIds).toEqual(["ent_a", "ent_b"]);

			broadcaster.dispose();
		} finally {
			vi.useRealTimers();
		}
	});

	it("heartbeat fires at ~15s cadence even without state changes", async () => {
		vi.useFakeTimers();
		try {
			const { broadcaster, awarenessByEntity, emit } = makeBroadcaster();
			const { awareness } = makeAwareness();
			awarenessByEntity.set("ent_a", awareness);
			awareness.setLocalState({ cursor: 1 });
			broadcaster.track("ent_a", awareness);

			// flush the initial debounce
			await vi.advanceTimersByTimeAsync(AWARENESS_DEBOUNCE_MS);
			(emit as ReturnType<typeof vi.fn>).mockClear();

			// advance one heartbeat — broadcaster should re-emit our state
			await vi.advanceTimersByTimeAsync(AWARENESS_HEARTBEAT_MS + 50);
			expect((emit as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(1);

			broadcaster.dispose();
		} finally {
			vi.useRealTimers();
		}
	});

	it("inbound applyAwarenessUpdate updates the local Awareness states map without re-broadcast", async () => {
		vi.useFakeTimers();
		try {
			const { broadcaster, awarenessByEntity, emit } = makeBroadcaster();
			const { awareness: local } = makeAwareness();
			awarenessByEntity.set("ent_a", local);
			broadcaster.track("ent_a", local);

			// flush any initial setLocalState({}) from the Awareness constructor
			await vi.advanceTimersByTimeAsync(AWARENESS_DEBOUNCE_MS);
			(emit as ReturnType<typeof vi.fn>).mockClear();

			// Build a remote awareness, get its encoded update, and feed it back in.
			const remote = makeAwareness();
			remote.awareness.setLocalState({ cursor: { line: 5 }, user: "bob" });
			const { encodeAwarenessUpdate } = await import("y-protocols/awareness");
			const update = encodeAwarenessUpdate(remote.awareness, [remote.awareness.clientID]);

			broadcaster.applyInbound(update, "ent_a");
			await vi.advanceTimersByTimeAsync(AWARENESS_DEBOUNCE_MS + 10);

			expect(local.states.get(remote.awareness.clientID)).toEqual({
				cursor: { line: 5 },
				user: "bob",
			});
			// No re-broadcast: the inbound origin is recognized and suppressed.
			expect((emit as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);

			broadcaster.dispose();
		} finally {
			vi.useRealTimers();
		}
	});

	it("dispose broadcasts a state=null update for each tracked entity (one envelope per entity)", async () => {
		vi.useFakeTimers();
		try {
			const { broadcaster, awarenessByEntity, emit } = makeBroadcaster();
			const a = makeAwareness();
			const b = makeAwareness();
			awarenessByEntity.set("ent_a", a.awareness);
			awarenessByEntity.set("ent_b", b.awareness);
			a.awareness.setLocalState({ cursor: 1 });
			b.awareness.setLocalState({ cursor: 2 });
			broadcaster.track("ent_a", a.awareness);
			broadcaster.track("ent_b", b.awareness);
			await vi.advanceTimersByTimeAsync(AWARENESS_DEBOUNCE_MS);
			(emit as ReturnType<typeof vi.fn>).mockClear();

			broadcaster.dispose();
			// emit calls are sync via Promise.resolve in the test stub; flush microtasks.
			await Promise.resolve();
			await Promise.resolve();

			expect(emit).toHaveBeenCalledTimes(2);
			const entityIds = (emit as ReturnType<typeof vi.fn>).mock.calls
				.map((call: unknown[]) => call[0])
				.sort();
			expect(entityIds).toEqual(["ent_a", "ent_b"]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("stale inbound updates (lower clock) drop with no observable state change", async () => {
		vi.useFakeTimers();
		try {
			const { broadcaster, awarenessByEntity } = makeBroadcaster();
			const { awareness: local } = makeAwareness();
			awarenessByEntity.set("ent_a", local);
			broadcaster.track("ent_a", local);
			await vi.advanceTimersByTimeAsync(AWARENESS_DEBOUNCE_MS);

			// Set up a remote with two states; capture both encoded updates.
			const remote = makeAwareness();
			const { encodeAwarenessUpdate } = await import("y-protocols/awareness");
			remote.awareness.setLocalState({ pos: 1 });
			const fresh = encodeAwarenessUpdate(remote.awareness, [remote.awareness.clientID]);
			remote.awareness.setLocalState({ pos: 2 });
			const newer = encodeAwarenessUpdate(remote.awareness, [remote.awareness.clientID]);

			// Apply newer first, then the stale one.
			broadcaster.applyInbound(newer, "ent_a");
			expect(local.states.get(remote.awareness.clientID)).toEqual({ pos: 2 });
			broadcaster.applyInbound(fresh, "ent_a");
			expect(local.states.get(remote.awareness.clientID)).toEqual({ pos: 2 });

			broadcaster.dispose();
		} finally {
			vi.useRealTimers();
		}
	});

	it("DEK-missing emit error is routed to onEmitError; local Awareness keeps updating", async () => {
		vi.useFakeTimers();
		try {
			const errors: Array<{ error: unknown; entityId: string }> = [];
			const failingEmit = vi.fn(async () => {
				const err = new Error("envelope-pipeline: no DEK for entity ent_a");
				err.name = "Unavailable";
				throw err;
			});
			const { broadcaster, awarenessByEntity } = makeBroadcaster({
				emit: failingEmit,
				onEmitError: (error, entityId) => errors.push({ error, entityId }),
			});
			const { awareness } = makeAwareness();
			awarenessByEntity.set("ent_a", awareness);
			broadcaster.track("ent_a", awareness);

			awareness.setLocalState({ cursor: 5 });
			await vi.advanceTimersByTimeAsync(AWARENESS_DEBOUNCE_MS);
			await Promise.resolve();
			await Promise.resolve();

			expect(errors.length).toBeGreaterThanOrEqual(1);
			const firstError = errors[0];
			if (!firstError) throw new Error("expected at least one emit error");
			expect((firstError.error as Error).name).toBe("Unavailable");
			// Local awareness still has the value we set.
			expect(awareness.getLocalState()).toEqual({ cursor: 5 });

			broadcaster.dispose();
		} finally {
			vi.useRealTimers();
		}
	});

	it("untrack-then-retrack rebuilds subscriptions and clears the previous heartbeat", async () => {
		vi.useFakeTimers();
		try {
			const { broadcaster, awarenessByEntity, emit } = makeBroadcaster();
			const a = makeAwareness();
			awarenessByEntity.set("ent_a", a.awareness);
			a.awareness.setLocalState({ cursor: 1 });
			broadcaster.track("ent_a", a.awareness);
			await vi.advanceTimersByTimeAsync(AWARENESS_DEBOUNCE_MS);
			(emit as ReturnType<typeof vi.fn>).mockClear();

			broadcaster.untrack("ent_a");
			await Promise.resolve();
			await Promise.resolve();
			// Untrack broadcasts a single null-state envelope.
			expect((emit as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
			(emit as ReturnType<typeof vi.fn>).mockClear();

			// After untrack, an unrelated awareness change must not emit.
			a.awareness.setLocalState({ cursor: 99 });
			await vi.advanceTimersByTimeAsync(AWARENESS_DEBOUNCE_MS * 4);
			expect(emit).not.toHaveBeenCalled();

			// Re-track and verify subscriptions are rebuilt.
			const b = makeAwareness();
			awarenessByEntity.set("ent_a", b.awareness);
			broadcaster.track("ent_a", b.awareness);
			b.awareness.setLocalState({ cursor: 7 });
			await vi.advanceTimersByTimeAsync(AWARENESS_DEBOUNCE_MS);
			expect((emit as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);

			broadcaster.dispose();
		} finally {
			vi.useRealTimers();
		}
	});

	it("applyInbound drops silently when the entity isn't tracked locally", async () => {
		const { broadcaster, awarenessByEntity, emit } = makeBroadcaster();
		const remote = makeAwareness();
		remote.awareness.setLocalState({ pos: 1 });
		const { encodeAwarenessUpdate } = await import("y-protocols/awareness");
		const update = encodeAwarenessUpdate(remote.awareness, [remote.awareness.clientID]);

		expect(() => broadcaster.applyInbound(update, "ent_missing")).not.toThrow();
		expect(emit).not.toHaveBeenCalled();
		expect(awarenessByEntity.has("ent_missing")).toBe(false);

		broadcaster.dispose();
	});
});

// Type sanity: applyAwarenessUpdate is the y-protocols apply we wrap.
void applyAwarenessUpdate;
