import { describe, expect, it } from "vitest";
import { createTypeaheadBuffer } from "./typeahead-buffer";

function controlledClock(start = 1000) {
	let t = start;
	return {
		now: () => t,
		advance(by: number) {
			t += by;
		},
	};
}

const ANIMALS = ["Apple", "Banana", "Apricot", "Blueberry", "avocado", "cherry"];

describe("createTypeaheadBuffer", () => {
	it("returns null with no labels", () => {
		const buf = createTypeaheadBuffer({ getLabel: () => "", count: () => 0 });
		expect(buf.append("a", -1)).toEqual({ index: null, buffer: "a" });
	});

	it("matches the first item whose label starts with the buffer (case-insensitive)", () => {
		const clock = controlledClock();
		const buf = createTypeaheadBuffer({
			getLabel: (i) => ANIMALS[i] as string,
			count: () => ANIMALS.length,
			now: clock.now,
		});
		expect(buf.append("b", -1)).toEqual({ index: 1, buffer: "b" });
		clock.advance(50);
		// "ba" → "Banana" (index 1) still matches; "Blueberry" doesn't start with "ba".
		expect(buf.append("a", 1)).toEqual({ index: 1, buffer: "ba" });
	});

	it("extending the buffer within resetMs keeps prefix matching tight", () => {
		const clock = controlledClock();
		const buf = createTypeaheadBuffer({
			getLabel: (i) => ANIMALS[i] as string,
			count: () => ANIMALS.length,
			resetMs: 500,
			now: clock.now,
		});
		expect(buf.append("a", -1).index).toBe(0); // Apple
		clock.advance(100);
		// "ap" — Apple AND Apricot match; first wins.
		expect(buf.append("p", 0).index).toBe(0);
		clock.advance(100);
		// "apr" — Apricot only.
		expect(buf.append("r", 0).index).toBe(2);
	});

	it("after the reset window expires the next char starts a fresh buffer", () => {
		const clock = controlledClock();
		const buf = createTypeaheadBuffer({
			getLabel: (i) => ANIMALS[i] as string,
			count: () => ANIMALS.length,
			resetMs: 500,
			now: clock.now,
		});
		expect(buf.append("a", -1).buffer).toBe("a");
		clock.advance(600); // past resetMs
		const next = buf.append("c", 0);
		expect(next.buffer).toBe("c");
		expect(next.index).toBe(5); // cherry
	});

	it("repeated same-character cycles through prefix-matching items", () => {
		const clock = controlledClock();
		const buf = createTypeaheadBuffer({
			getLabel: (i) => ANIMALS[i] as string,
			count: () => ANIMALS.length,
			now: clock.now,
		});
		// First "a" with no hint → Apple (index 0).
		expect(buf.append("a", -1).index).toBe(0);
		clock.advance(50);
		// Second "a" with hint=0 → next "a"-prefix from index 1 onward → Apricot (2).
		expect(buf.append("a", 0).index).toBe(2);
		clock.advance(50);
		// Third "a" with hint=2 → next "a"-prefix from index 3 onward → avocado (4).
		expect(buf.append("a", 2).index).toBe(4);
		clock.advance(50);
		// Fourth "a" → wraps back to Apple (0).
		expect(buf.append("a", 4).index).toBe(0);
	});

	it("returns null index but keeps the buffer when nothing matches", () => {
		const clock = controlledClock();
		const buf = createTypeaheadBuffer({
			getLabel: (i) => ANIMALS[i] as string,
			count: () => ANIMALS.length,
			now: clock.now,
		});
		const r = buf.append("z", -1);
		expect(r).toEqual({ index: null, buffer: "z" });
	});

	it("reset() clears the buffer immediately", () => {
		const clock = controlledClock();
		const buf = createTypeaheadBuffer({
			getLabel: (i) => ANIMALS[i] as string,
			count: () => ANIMALS.length,
			now: clock.now,
		});
		expect(buf.append("a", -1).buffer).toBe("a");
		buf.reset();
		clock.advance(10);
		expect(buf.append("b", -1).buffer).toBe("b");
	});

	it("empty input character returns null without disturbing the buffer", () => {
		const clock = controlledClock();
		const buf = createTypeaheadBuffer({
			getLabel: (i) => ANIMALS[i] as string,
			count: () => ANIMALS.length,
			now: clock.now,
		});
		expect(buf.append("a", -1).index).toBe(0);
		clock.advance(50);
		const r = buf.append("", 0);
		expect(r.index).toBe(null);
		expect(r.buffer).toBe("a");
	});

	// Property test: extending the buffer within resetMs is monotonic — the
	// matched index either stays the same or moves to a later index whose
	// label starts with the longer prefix; never to an earlier index.
	it("PROP: prefix-extension within window never matches an earlier item", () => {
		const labels = ["alpha", "alphabet", "alpine", "almond", "banana"];
		const clock = controlledClock();
		const buf = createTypeaheadBuffer({
			getLabel: (i) => labels[i] as string,
			count: () => labels.length,
			resetMs: 500,
			now: clock.now,
		});
		const r1 = buf.append("a", -1);
		expect(r1.index).toBe(0);
		clock.advance(10);
		const r2 = buf.append("l", 0);
		expect(r2.index).toBe(0);
		clock.advance(10);
		const r3 = buf.append("p", 0);
		expect(r3.index).toBe(0);
		clock.advance(10);
		const r4 = buf.append("i", 0);
		expect(r4.index).toBe(2); // "alpine"
	});

	// Property test: after `resetMs` ms the buffer always equals the single
	// character just typed.
	it("PROP: post-reset buffer length is exactly 1", () => {
		const clock = controlledClock();
		const labels = ["foo", "bar", "baz"];
		const buf = createTypeaheadBuffer({
			getLabel: (i) => labels[i] as string,
			count: () => labels.length,
			resetMs: 100,
			now: clock.now,
		});
		for (const c of ["b", "a", "z"]) {
			clock.advance(200);
			const r = buf.append(c, -1);
			expect(r.buffer.length).toBe(1);
		}
	});
});
