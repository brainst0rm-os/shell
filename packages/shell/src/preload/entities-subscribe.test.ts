/**
 * Tests for the 9.12.5 entities.subscribe hub — initial fire, signal →
 * re-query → de-dup, in-flight coalescing (exactly one trailing re-query),
 * unsubscribe isolation, and error containment.
 */

import { describe, expect, it } from "vitest";
import { createEntitySubscriptionHub, resultSignature } from "./entities-subscribe";

type Row = { id: string; updatedAt: number };

function deferredQueue(results: Row[][]) {
	let calls = 0;
	const pendingResolvers: Array<(rows: Row[]) => void> = [];
	const runQuery = (_query: { type: string }): Promise<Row[]> => {
		calls += 1;
		const preset = results.shift();
		if (preset) return Promise.resolve(preset);
		return new Promise<Row[]>((resolve) => {
			pendingResolvers.push(resolve);
		});
	};
	return {
		runQuery,
		callCount: () => calls,
		release: (rows: Row[]) => pendingResolvers.shift()?.(rows),
	};
}

async function flush(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("createEntitySubscriptionHub", () => {
	it("fires the initial result on subscribe", async () => {
		const hub = createEntitySubscriptionHub<{ type: string }, Row>(async () => [
			{ id: "a", updatedAt: 1 },
		]);
		const seen: Row[][] = [];
		hub.subscribe({ type: "T" }, (rows) => seen.push(rows));
		await flush();
		expect(seen).toEqual([[{ id: "a", updatedAt: 1 }]]);
	});

	it("re-queries on notifyChanged and pushes only when the result changed", async () => {
		let rows: Row[] = [{ id: "a", updatedAt: 1 }];
		const hub = createEntitySubscriptionHub<{ type: string }, Row>(async () => rows);
		const seen: Row[][] = [];
		hub.subscribe({ type: "T" }, (r) => seen.push(r));
		await flush();

		hub.notifyChanged(); // identical result → no push
		await flush();
		expect(seen).toHaveLength(1);

		rows = [{ id: "a", updatedAt: 2 }];
		hub.notifyChanged();
		await flush();
		expect(seen).toHaveLength(2);
		expect(seen[1]).toEqual([{ id: "a", updatedAt: 2 }]);
	});

	it("coalesces signals while a re-query is in flight (one trailing run)", async () => {
		const q = deferredQueue([[{ id: "a", updatedAt: 1 }]]);
		const hub = createEntitySubscriptionHub<{ type: string }, Row>(q.runQuery);
		const seen: Row[][] = [];
		hub.subscribe({ type: "T" }, (r) => seen.push(r));
		await flush();
		expect(q.callCount()).toBe(1);

		hub.notifyChanged(); // starts query #2 (deferred)
		await flush();
		hub.notifyChanged(); // in flight → pending
		hub.notifyChanged(); // still one pending, not three
		expect(q.callCount()).toBe(2);

		q.release([{ id: "a", updatedAt: 2 }]); // resolves #2 → trailing #3 starts
		await flush();
		expect(q.callCount()).toBe(3);
		q.release([{ id: "a", updatedAt: 2 }]); // trailing run, unchanged → no push
		await flush();
		expect(seen).toHaveLength(2);
	});

	it("unsubscribe stops pushes and drops the subscription", async () => {
		let rows: Row[] = [{ id: "a", updatedAt: 1 }];
		const hub = createEntitySubscriptionHub<{ type: string }, Row>(async () => rows);
		const seen: Row[][] = [];
		const sub = hub.subscribe({ type: "T" }, (r) => seen.push(r));
		await flush();
		sub.unsubscribe();
		expect(hub.size()).toBe(0);

		rows = [{ id: "a", updatedAt: 2 }];
		hub.notifyChanged();
		await flush();
		expect(seen).toHaveLength(1);
	});

	it("a result landing after unsubscribe is discarded", async () => {
		const q = deferredQueue([]);
		const hub = createEntitySubscriptionHub<{ type: string }, Row>(q.runQuery);
		const seen: Row[][] = [];
		const sub = hub.subscribe({ type: "T" }, (r) => seen.push(r));
		sub.unsubscribe();
		q.release([{ id: "a", updatedAt: 1 }]);
		await flush();
		expect(seen).toEqual([]);
	});

	it("a throwing query is contained and reported, not unhandled", async () => {
		const errors: unknown[] = [];
		const hub = createEntitySubscriptionHub<{ type: string }, Row>(
			async () => {
				throw new Error("broker down");
			},
			(e) => errors.push(e),
		);
		hub.subscribe({ type: "T" }, () => undefined);
		await flush();
		expect(errors).toHaveLength(1);
	});

	it("a throwing onUpdate listener is contained per subscription", async () => {
		const errors: unknown[] = [];
		const hub = createEntitySubscriptionHub<{ type: string }, Row>(
			async () => [{ id: "a", updatedAt: 1 }],
			(e) => errors.push(e),
		);
		const seen: Row[][] = [];
		hub.subscribe({ type: "T" }, () => {
			throw new Error("listener bug");
		});
		hub.subscribe({ type: "T" }, (r) => seen.push(r));
		await flush();
		expect(errors).toHaveLength(1);
		expect(seen).toHaveLength(1);
	});

	it("subscriptions are independent — each query gets its own results", async () => {
		const hub = createEntitySubscriptionHub<{ type: string }, Row>(async (query) =>
			query.type === "A" ? [{ id: "a", updatedAt: 1 }] : [{ id: "b", updatedAt: 1 }],
		);
		const seenA: Row[][] = [];
		const seenB: Row[][] = [];
		hub.subscribe({ type: "A" }, (r) => seenA.push(r));
		hub.subscribe({ type: "B" }, (r) => seenB.push(r));
		await flush();
		expect(seenA[0]?.[0]?.id).toBe("a");
		expect(seenB[0]?.[0]?.id).toBe("b");
		expect(hub.size()).toBe(2);
	});
});

describe("resultSignature", () => {
	it("is order-sensitive and updatedAt-sensitive", () => {
		const a = [{ id: "x", updatedAt: 1 }];
		expect(resultSignature(a)).toBe(resultSignature([{ id: "x", updatedAt: 1 }]));
		expect(resultSignature(a)).not.toBe(resultSignature([{ id: "x", updatedAt: 2 }]));
		expect(resultSignature([])).toBe("");
	});
});
