import { describe, expect, it, vi } from "vitest";
import { type YStoreOptions, createYStore, shallowMapEquals } from "./subscription";

/** A controllable target standing in for a Yjs object: `emit()` fires the
 *  bound change handler; `value` is what `read()` returns. */
function controllable<T>(initial: T) {
	let value = initial;
	let handler: (() => void) | null = null;
	let bindCount = 0;
	let unbindCount = 0;
	const opts: YStoreOptions<T> = {
		bind: (onChange) => {
			bindCount += 1;
			handler = onChange;
			return () => {
				unbindCount += 1;
				handler = null;
			};
		},
		read: () => value,
	};
	return {
		opts,
		set(next: T) {
			value = next;
		},
		emit() {
			handler?.();
		},
		get bound() {
			return handler !== null;
		},
		get bindCount() {
			return bindCount;
		},
		get unbindCount() {
			return unbindCount;
		},
	};
}

const microtask = () => Promise.resolve();

describe("createYStore", () => {
	it("coalesces many synchronous changes into one notification per microtask", async () => {
		const c = controllable(0);
		const store = createYStore(c.opts);
		const listener = vi.fn();
		store.subscribe(listener);

		c.set(1);
		c.emit();
		c.set(2);
		c.emit();
		c.set(3);
		c.emit();

		expect(listener).not.toHaveBeenCalled(); // still within the same tick
		await microtask();
		expect(listener).toHaveBeenCalledTimes(1);
		expect(store.getSnapshot()).toBe(3);
	});

	it("flush() applies the pending change synchronously", () => {
		const c = controllable("a");
		const store = createYStore(c.opts);
		const listener = vi.fn();
		store.subscribe(listener);

		c.set("b");
		c.emit();
		store.flush();

		expect(listener).toHaveBeenCalledTimes(1);
		expect(store.getSnapshot()).toBe("b");
	});

	it("does not notify when the recomputed snapshot is equal", async () => {
		const c = controllable(7);
		const store = createYStore(c.opts);
		const listener = vi.fn();
		store.subscribe(listener);

		c.emit(); // value unchanged
		await microtask();

		expect(listener).not.toHaveBeenCalled();
		expect(store.getSnapshot()).toBe(7);
	});

	it("getSnapshot is referentially stable until a real change", () => {
		const c = controllable<{ n: number }>({ n: 1 });
		const store = createYStore(c.opts);
		const first = store.getSnapshot();
		expect(store.getSnapshot()).toBe(first);
		store.subscribe(() => {});
		expect(store.getSnapshot()).toBe(first);
	});

	it("binds once for multiple subscribers and unbinds on the last unsubscribe", () => {
		const c = controllable(0);
		const store = createYStore(c.opts);
		const offA = store.subscribe(() => {});
		const offB = store.subscribe(() => {});
		expect(c.bindCount).toBe(1);
		expect(c.bound).toBe(true);

		offA();
		expect(c.bound).toBe(true);
		offB();
		expect(c.bound).toBe(false);
		expect(c.unbindCount).toBe(1);
	});

	it("resyncs the snapshot when the first subscriber binds (state moved pre-mount)", () => {
		const c = controllable("initial");
		const store = createYStore(c.opts);
		c.set("moved-before-mount");
		const listener = vi.fn();
		store.subscribe(listener);
		expect(store.getSnapshot()).toBe("moved-before-mount");
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("dispose detaches the observer and ignores later changes", async () => {
		const c = controllable(0);
		const store = createYStore(c.opts);
		const listener = vi.fn();
		store.subscribe(listener);
		store.dispose();
		expect(c.bound).toBe(false);

		c.set(99);
		c.emit();
		store.flush();
		await microtask();
		expect(listener).not.toHaveBeenCalled();
		expect(store.subscribe(vi.fn())).toBeTypeOf("function");
	});

	it("a change emitted before its microtask but after unsubscribe does not notify a gone listener", async () => {
		const c = controllable(0);
		const store = createYStore(c.opts);
		const listener = vi.fn();
		const off = store.subscribe(listener);
		c.set(1);
		c.emit();
		off();
		await microtask();
		expect(listener).not.toHaveBeenCalled();
	});
});

describe("shallowMapEquals", () => {
	it("is true for identical and shallow-equal maps, false otherwise", () => {
		const a = new Map([["x", 1]]);
		expect(shallowMapEquals(a, a)).toBe(true);
		expect(shallowMapEquals(new Map([["x", 1]]), new Map([["x", 1]]))).toBe(true);
		expect(shallowMapEquals(new Map([["x", 1]]), new Map([["x", 2]]))).toBe(false);
		expect(shallowMapEquals(new Map([["x", 1]]), new Map([["y", 1]]))).toBe(false);
		expect(shallowMapEquals(new Map([["x", 1]]), new Map())).toBe(false);
	});
});
