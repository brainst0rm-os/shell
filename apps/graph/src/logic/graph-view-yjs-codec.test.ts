/**
 * Codec tests for the per-view coordinate store (9.13.6, OQ-GR-2 (a)).
 * Round-trip, diff behaviour, tolerant decode, the 50k hard cap, and the
 * load-bearing convergence cases: concurrent drags of *different* nodes
 * merge (structural), concurrent drags of the *same* node converge
 * per-field (LWW) on both replicas.
 */

import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
	GraphViewDocField,
	MAX_VIEW_COORDS,
	type NodeCoord,
	decodeCoordsFromDoc,
	encodeCoordsIntoDoc,
} from "./graph-view-yjs-codec";

function coordMap(entries: Record<string, NodeCoord>): Map<string, NodeCoord> {
	return new Map(Object.entries(entries));
}

function sync(a: Y.Doc, b: Y.Doc): void {
	Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
	Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
}

describe("graph-view-yjs-codec", () => {
	it("round-trips a coordinate set", () => {
		const doc = new Y.Doc();
		const coords = coordMap({
			n1: { x: 10.5, y: -20.25, pinned: true },
			n2: { x: 0, y: 0, pinned: false },
		});
		encodeCoordsIntoDoc(doc, coords);
		expect(decodeCoordsFromDoc(doc)).toEqual(coords);
	});

	it("re-encode removes nodes absent from the new set and updates moved ones", () => {
		const doc = new Y.Doc();
		encodeCoordsIntoDoc(
			doc,
			coordMap({
				n1: { x: 1, y: 1, pinned: true },
				n2: { x: 2, y: 2, pinned: true },
			}),
		);
		encodeCoordsIntoDoc(doc, coordMap({ n1: { x: 5, y: 6, pinned: true } }));
		expect(decodeCoordsFromDoc(doc)).toEqual(coordMap({ n1: { x: 5, y: 6, pinned: true } }));
	});

	it("encoding an identical set produces no update (diff-aware)", () => {
		const doc = new Y.Doc();
		const coords = coordMap({ n1: { x: 3, y: 4, pinned: true } });
		encodeCoordsIntoDoc(doc, coords);
		const before = Y.encodeStateVector(doc);
		encodeCoordsIntoDoc(doc, coords);
		expect(Y.encodeStateAsUpdate(doc, before).length).toBeLessThanOrEqual(2);
	});

	it("skips non-finite coordinates at encode time", () => {
		const doc = new Y.Doc();
		encodeCoordsIntoDoc(
			doc,
			coordMap({
				bad1: { x: Number.NaN, y: 1, pinned: true },
				bad2: { x: 1, y: Number.POSITIVE_INFINITY, pinned: true },
				good: { x: 1, y: 2, pinned: false },
			}),
		);
		expect(decodeCoordsFromDoc(doc)).toEqual(coordMap({ good: { x: 1, y: 2, pinned: false } }));
	});

	it("decode tolerates malformed entries (wrong types, garbage values)", () => {
		const doc = new Y.Doc();
		const map = doc.getMap<unknown>(GraphViewDocField.Coords);
		doc.transact(() => {
			map.set("notAMap", "garbage");
			const noNumbers = new Y.Map<unknown>();
			noNumbers.set("x", "ten");
			noNumbers.set("y", 5);
			map.set("noNumbers", noNumbers);
			const good = new Y.Map<unknown>();
			good.set("x", 7);
			good.set("y", 8);
			good.set("pinned", "yes"); // non-boolean → reads as false
			map.set("good", good);
		});
		expect(decodeCoordsFromDoc(doc)).toEqual(coordMap({ good: { x: 7, y: 8, pinned: false } }));
	});

	it("decode of an empty doc yields an empty map", () => {
		expect(decodeCoordsFromDoc(new Y.Doc()).size).toBe(0);
	});

	it("caps the written entries at MAX_VIEW_COORDS", () => {
		const doc = new Y.Doc();
		const coords = new Map<string, NodeCoord>();
		// Building 50k+1 real entries is slow under the per-entry Y.Map shape;
		// exercise the cap arithmetic on a small synthetic cap instead is not
		// possible (const), so prove the boundary with exactly cap + 2 cheap
		// entries but only assert the decoded size.
		for (let i = 0; i < MAX_VIEW_COORDS + 2; i += 1) {
			coords.set(`n${i}`, { x: i, y: i, pinned: false });
		}
		encodeCoordsIntoDoc(doc, coords);
		expect(decodeCoordsFromDoc(doc).size).toBe(MAX_VIEW_COORDS);
	}, 30_000);

	it("concurrent drags of different nodes merge structurally", () => {
		const a = new Y.Doc();
		const b = new Y.Doc();
		const base = coordMap({
			n1: { x: 1, y: 1, pinned: true },
			n2: { x: 2, y: 2, pinned: true },
		});
		encodeCoordsIntoDoc(a, base);
		sync(a, b);

		encodeCoordsIntoDoc(
			a,
			coordMap({ n1: { x: 100, y: 100, pinned: true }, n2: { x: 2, y: 2, pinned: true } }),
		);
		encodeCoordsIntoDoc(
			b,
			coordMap({ n1: { x: 1, y: 1, pinned: true }, n2: { x: 200, y: 200, pinned: true } }),
		);
		sync(a, b);

		const expected = coordMap({
			n1: { x: 100, y: 100, pinned: true },
			n2: { x: 200, y: 200, pinned: true },
		});
		expect(decodeCoordsFromDoc(a)).toEqual(expected);
		expect(decodeCoordsFromDoc(b)).toEqual(expected);
	});

	it("concurrent drags of the same node converge identically on both replicas", () => {
		const a = new Y.Doc();
		const b = new Y.Doc();
		encodeCoordsIntoDoc(a, coordMap({ n1: { x: 0, y: 0, pinned: true } }));
		sync(a, b);

		encodeCoordsIntoDoc(a, coordMap({ n1: { x: 10, y: 11, pinned: true } }));
		encodeCoordsIntoDoc(b, coordMap({ n1: { x: 20, y: 21, pinned: true } }));
		sync(a, b);

		const fromA = decodeCoordsFromDoc(a);
		const fromB = decodeCoordsFromDoc(b);
		expect(fromA).toEqual(fromB);
		const n1 = fromA.get("n1");
		expect(n1).toBeDefined();
		// Per-field LWW: each axis lands on one of the two written values.
		expect([10, 20]).toContain(n1?.x);
		expect([11, 21]).toContain(n1?.y);
	});
});
