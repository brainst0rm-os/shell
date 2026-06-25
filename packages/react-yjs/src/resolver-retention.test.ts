import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { type YDocTransport, createYDocResolver } from "./resolver.js";

/** A transport whose `persist` accumulates updates into a single canonical
 *  snapshot, so `load` reflects everything persisted so far. `release`,
 *  `persist` and `load` are spies so tests can assert the retention /
 *  no-reload / deferred-close behaviour. */
function makeAccumulatingTransport(): {
	transport: YDocTransport;
	persist: ReturnType<typeof vi.fn>;
	release: ReturnType<typeof vi.fn>;
	load: ReturnType<typeof vi.fn>;
} {
	const canonical = new Y.Doc();
	const persist = vi.fn((_id: string, update: Uint8Array) => {
		Y.applyUpdate(canonical, update);
	});
	const load = vi.fn(async (_id: string): Promise<Uint8Array | null> => {
		const state = Y.encodeStateAsUpdate(canonical);
		return state.length > 0 ? state : null;
	});
	const release = vi.fn((_id: string) => {});
	return { transport: { load, persist, release }, persist, release, load };
}

const ID = "entity-A";

describe("createYDocResolver retention", () => {
	it("serves a navigate-back reopen from memory: content preserved, no reload, canonical not closed", async () => {
		const { transport, release, load } = makeAccumulatingTransport();
		const resolver = createYDocResolver(transport);

		const first = resolver.resolve(ID);
		await first.applyPending?.();
		first.doc.getText("body").insert(0, "hello");
		expect(load).toHaveBeenCalledTimes(1); // initial open loaded once

		first.release();

		// Retention defers the canonical close — `transport.release` MUST NOT
		// fire on the eager release, so it can't race the just-shipped persist.
		expect(release).not.toHaveBeenCalled();

		// Navigate back: a FRESH doc is seeded from the retained replica's
		// in-memory state (no second `load`), and populates after applyPending
		// so the editor binding's observeDeep fires (a reused populated
		// instance would render blank — that's why the doc identity changes).
		const second = resolver.resolve(ID);
		await second.applyPending?.();
		expect(second.doc.getText("body").toString()).toBe("hello");
		expect(load).toHaveBeenCalledTimes(1); // revival did NOT reload over IPC

		second.release();
		resolver.dispose();
	});

	it("does not lose a just-persisted update across release→resolve", async () => {
		const { transport, persist } = makeAccumulatingTransport();
		const resolver = createYDocResolver(transport);

		const h = resolver.resolve(ID);
		await h.applyPending?.();
		// Sub-page insert analogue: a local update fired right before release.
		h.doc.getText("body").insert(0, "page-ref");
		expect(persist).toHaveBeenCalledTimes(1);
		h.release();

		const again = resolver.resolve(ID);
		await again.applyPending?.();
		expect(again.doc.getText("body").toString()).toBe("page-ref");
		again.release();
		resolver.dispose();
	});

	it("revives from disk when the retained replica never hydrated (released before applyPending)", async () => {
		const { transport, load } = makeAccumulatingTransport();

		// Session 1: seed the canonical snapshot through a fully-hydrated handle,
		// then dispose so nothing is retained — canonical lives in the transport.
		const seeder = createYDocResolver(transport, { retentionCap: 0 });
		const s = seeder.resolve(ID);
		await s.applyPending?.();
		s.doc.getText("body").insert(0, "hello");
		s.release();
		seeder.dispose();

		// Session 2: the race — open a replica and release it BEFORE applyPending
		// ever runs, so the retained replica is still empty (unhydrated).
		const resolver = createYDocResolver(transport);
		const cold = resolver.resolve(ID);
		cold.release(); // retained, but applyPending never called → empty doc

		load.mockClear();
		// Reopen: the unhydrated replica must NOT be used as the seed (that would
		// render blank and shadow the disk snapshot) — it must fall back to load.
		const reopened = resolver.resolve(ID);
		await reopened.applyPending?.();
		expect(reopened.doc.getText("body").toString()).toBe("hello");
		expect(load).toHaveBeenCalledTimes(1); // fell back to the canonical disk load

		reopened.release();
		resolver.dispose();
	});

	it("evicts the least-recently-released entry past the retention cap", () => {
		const { transport, release } = makeAccumulatingTransport();
		const resolver = createYDocResolver(transport, { retentionCap: 2 });

		const a = resolver.resolve("a");
		const b = resolver.resolve("b");
		const c = resolver.resolve("c");
		a.release(); // retained: [a]
		b.release(); // retained: [a, b]
		c.release(); // over cap (2) → evict oldest "a"

		expect(release).toHaveBeenCalledTimes(1);
		expect(release).toHaveBeenCalledWith("a");

		// Reopening "b" reuses the retained entry — no canonical churn.
		release.mockClear();
		resolver.resolve("b").release();
		expect(release).not.toHaveBeenCalled();

		resolver.dispose();
	});

	it("retentionCap:0 preserves the old eager-release behaviour", () => {
		const { transport, release } = makeAccumulatingTransport();
		const resolver = createYDocResolver(transport, { retentionCap: 0 });
		const h = resolver.resolve(ID);
		h.release();
		expect(release).toHaveBeenCalledTimes(1);
		expect(release).toHaveBeenCalledWith(ID);
		resolver.dispose();
	});

	it("dispose tears down retained zero-ref entries", () => {
		const { transport, release } = makeAccumulatingTransport();
		const resolver = createYDocResolver(transport);
		const h = resolver.resolve(ID);
		const doc = h.doc;
		h.release();
		expect(release).not.toHaveBeenCalled();
		resolver.dispose();
		expect(release).toHaveBeenCalledWith(ID);
		expect(doc.isDestroyed).toBe(true);
	});
});
