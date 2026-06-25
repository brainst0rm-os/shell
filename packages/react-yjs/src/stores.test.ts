import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { yDocStore, yMapKeyStore, yMapStore, yTextStore, yXmlFragmentStore } from "./stores";

const microtask = () => Promise.resolve();

describe("yTextStore", () => {
	it("reflects the text and coalesces a multi-op transaction into one notify", async () => {
		const doc = new Y.Doc();
		const text = doc.getText("t");
		const store = yTextStore(text);
		const listener = vi.fn();
		store.subscribe(listener);

		doc.transact(() => {
			text.insert(0, "hello");
			text.insert(5, " world");
		});

		await microtask();
		expect(listener).toHaveBeenCalledTimes(1);
		expect(store.getSnapshot()).toBe("hello world");
	});
});

describe("yMapStore", () => {
	it("snapshots entries and stays referentially stable across an equal recompute", async () => {
		const doc = new Y.Doc();
		const map = doc.getMap<number>("props");
		map.set("a", 1);
		const store = yMapStore(map);
		store.subscribe(() => {});
		const snap = store.getSnapshot();
		expect(snap.get("a")).toBe(1);

		// A transaction that nets no change leaves the snapshot identical.
		doc.transact(() => {
			map.set("a", 2);
			map.set("a", 1);
		});
		await microtask();
		expect(store.getSnapshot()).toBe(snap);

		map.set("b", 9);
		await microtask();
		expect(store.getSnapshot()).not.toBe(snap);
		expect(store.getSnapshot().get("b")).toBe(9);
	});
});

describe("yMapKeyStore", () => {
	it("tracks a single key and ignores sibling-key changes", async () => {
		const doc = new Y.Doc();
		const map = doc.getMap<string>("props");
		const store = yMapKeyStore(map, "title");
		const listener = vi.fn();
		store.subscribe(listener);

		map.set("other", "x");
		await microtask();
		expect(listener).not.toHaveBeenCalled();
		expect(store.getSnapshot()).toBeUndefined();

		map.set("title", "Hello");
		await microtask();
		expect(listener).toHaveBeenCalledTimes(1);
		expect(store.getSnapshot()).toBe("Hello");
	});
});

describe("yDocStore", () => {
	it("bumps its version on every update and not otherwise", async () => {
		const doc = new Y.Doc();
		const store = yDocStore(doc);
		store.subscribe(() => {});
		const v0 = store.getSnapshot();

		doc.getMap("m").set("k", 1);
		await microtask();
		const v1 = store.getSnapshot();
		expect(v1).not.toBe(v0);

		doc.getArray("a").push([1]);
		await microtask();
		expect(store.getSnapshot()).not.toBe(v1);
	});

	it("converges across two replicas exchanging updates (CRDT round-trip)", () => {
		const a = new Y.Doc();
		const b = new Y.Doc();
		const sync = (from: Y.Doc, to: Y.Doc) =>
			Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)));

		const ta = a.getText("t");
		const tb = b.getText("t");
		let rng = 123456789;
		const rand = () => {
			rng = (rng * 1103515245 + 12345) & 0x7fffffff;
			return rng / 0x7fffffff;
		};

		for (let i = 0; i < 200; i++) {
			const doc = rand() < 0.5 ? a : b;
			const t = doc === a ? ta : tb;
			const len = t.length;
			if (rand() < 0.7 || len === 0) {
				t.insert(Math.floor(rand() * (len + 1)), String.fromCharCode(97 + (i % 26)));
			} else {
				t.delete(Math.floor(rand() * len), 1);
			}
			if (i % 7 === 0) {
				sync(a, b);
				sync(b, a);
			}
		}
		sync(a, b);
		sync(b, a);
		sync(a, b);
		expect(ta.toString()).toBe(tb.toString());
	});
});

describe("yXmlFragmentStore", () => {
	it("bumps version on deep fragment mutations", async () => {
		const doc = new Y.Doc();
		const frag = doc.getXmlFragment("frag");
		const store = yXmlFragmentStore(frag);
		store.subscribe(() => {});
		const v0 = store.getSnapshot();

		const el = new Y.XmlElement("p");
		frag.insert(0, [el]);
		await microtask();
		const v1 = store.getSnapshot();
		expect(v1).not.toBe(v0);

		el.setAttribute("class", "lead");
		await microtask();
		expect(store.getSnapshot()).not.toBe(v1);
	});
});
