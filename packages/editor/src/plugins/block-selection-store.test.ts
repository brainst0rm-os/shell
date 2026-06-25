import { describe, expect, it, vi } from "vitest";
import { BlockSelectionStore } from "./block-selection-store";

describe("BlockSelectionStore", () => {
	it("starts empty with stable EMPTY snapshot", () => {
		const store = new BlockSelectionStore();
		const a = store.getSnapshot();
		const b = store.getSnapshot();
		expect(a).toBe(b);
		expect(a.selectedKeys.size).toBe(0);
		expect(a.anchorKey).toBeNull();
		expect(a.focusKey).toBeNull();
	});

	it("setOnly creates a single-key selection with that key as anchor and focus", () => {
		const store = new BlockSelectionStore();
		store.setOnly("k1");
		const s = store.getSnapshot();
		expect(s.anchorKey).toBe("k1");
		expect(s.focusKey).toBe("k1");
		expect([...s.selectedKeys]).toEqual(["k1"]);
	});

	it("toggle adds, removes, and clears to EMPTY at zero", () => {
		const store = new BlockSelectionStore();
		store.toggle("a");
		expect(store.has("a")).toBe(true);
		expect(store.getSnapshot().anchorKey).toBe("a");
		expect(store.getSnapshot().focusKey).toBe("a");

		store.toggle("b");
		expect(store.getSnapshot().selectedKeys.size).toBe(2);
		expect(store.getSnapshot().anchorKey).toBe("b");
		expect(store.getSnapshot().focusKey).toBe("b");

		store.toggle("a");
		expect(store.has("a")).toBe(false);
		expect(store.has("b")).toBe(true);

		store.toggle("b");
		expect(store.getSnapshot().selectedKeys.size).toBe(0);
		expect(store.getSnapshot().anchorKey).toBeNull();
		expect(store.getSnapshot().focusKey).toBeNull();
	});

	it("toggle that removes the anchor picks a remaining key as new anchor", () => {
		const store = new BlockSelectionStore();
		store.toggle("a");
		store.toggle("b");
		expect(store.getSnapshot().anchorKey).toBe("b");
		store.toggle("b");
		expect(store.getSnapshot().anchorKey).toBe("a");
		expect(store.getSnapshot().focusKey).toBe("a");
	});

	it("setRange replaces the selection with the supplied anchor and focus", () => {
		const store = new BlockSelectionStore();
		store.setOnly("a");
		store.setRange(["a", "b", "c"], "a", "c");
		const s = store.getSnapshot();
		expect([...s.selectedKeys].sort()).toEqual(["a", "b", "c"]);
		expect(s.anchorKey).toBe("a");
		expect(s.focusKey).toBe("c");
	});

	it("setRange with empty list clears", () => {
		const store = new BlockSelectionStore();
		store.setOnly("a");
		store.setRange([], "a", "a");
		expect(store.getSnapshot().selectedKeys.size).toBe(0);
		expect(store.getSnapshot().focusKey).toBeNull();
	});

	it("clear is idempotent and does not notify when already empty", () => {
		const store = new BlockSelectionStore();
		const spy = vi.fn();
		store.subscribe(spy);
		store.clear();
		expect(spy).not.toHaveBeenCalled();

		store.setOnly("a");
		store.clear();
		expect(spy).toHaveBeenCalledTimes(2);

		store.clear();
		expect(spy).toHaveBeenCalledTimes(2);
	});

	it("subscribe + unsubscribe", () => {
		const store = new BlockSelectionStore();
		const spy = vi.fn();
		const unsub = store.subscribe(spy);
		store.setOnly("a");
		expect(spy).toHaveBeenCalledTimes(1);
		unsub();
		store.setOnly("b");
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it("snapshots are referentially stable when nothing changes", () => {
		const store = new BlockSelectionStore();
		store.setOnly("a");
		const s1 = store.getSnapshot();
		const s2 = store.getSnapshot();
		expect(s1).toBe(s2);
	});

	it("snapshots are fresh objects on each change", () => {
		const store = new BlockSelectionStore();
		store.setOnly("a");
		const s1 = store.getSnapshot();
		store.toggle("b");
		const s2 = store.getSnapshot();
		expect(s1).not.toBe(s2);
		expect(s1.selectedKeys).not.toBe(s2.selectedKeys);
	});

	it("setRange supports anchor != focus and either direction", () => {
		const store = new BlockSelectionStore();
		store.setRange(["b", "c", "d"], "d", "b");
		const s = store.getSnapshot();
		expect(s.anchorKey).toBe("d");
		expect(s.focusKey).toBe("b");
		expect([...s.selectedKeys].sort()).toEqual(["b", "c", "d"]);
	});
});
