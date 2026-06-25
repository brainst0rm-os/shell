import { describe, expect, it, vi } from "vitest";
import { type FocusTrapEntry, applyEscape, createFocusTrapStack } from "./focus-trap";

function entry(id: string, onEscape: () => void = () => {}): FocusTrapEntry {
	return { id, onEscape };
}

function lcg(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 0x100000000;
	};
}

describe("createFocusTrapStack — basics", () => {
	it("starts empty", () => {
		const s = createFocusTrapStack();
		expect(s.size()).toBe(0);
		expect(s.peek()).toBe(null);
	});

	it("push returns an unsubscribe that pops the matching id", () => {
		const s = createFocusTrapStack();
		const offA = s.push(entry("a"));
		s.push(entry("b"));
		expect(s.peek()?.id).toBe("b");
		offA();
		expect(s.peek()?.id).toBe("b");
		expect(s.size()).toBe(1);
	});

	it("popTop removes the most-recent push and returns it", () => {
		const s = createFocusTrapStack();
		s.push(entry("a"));
		s.push(entry("b"));
		expect(s.popTop()?.id).toBe("b");
		expect(s.popTop()?.id).toBe("a");
		expect(s.popTop()).toBe(null);
	});

	it("clear empties the stack", () => {
		const s = createFocusTrapStack();
		s.push(entry("a"));
		s.push(entry("b"));
		s.clear();
		expect(s.size()).toBe(0);
		expect(s.peek()).toBe(null);
	});

	it("unsubscribe for an already-removed id is a no-op", () => {
		const s = createFocusTrapStack();
		const off = s.push(entry("a"));
		off();
		expect(() => off()).not.toThrow();
		expect(s.size()).toBe(0);
	});
});

describe("LIFO property: any interleaving preserves order for live ids", () => {
	it("peek always returns the most recent still-live push", () => {
		const rand = lcg(0xdeadc0de);
		for (let trial = 0; trial < 50; trial++) {
			const stack = createFocusTrapStack();
			const offs: Array<{ id: string; off: () => void }> = [];
			const expected: string[] = [];
			const opCount = 5 + Math.floor(rand() * 40);
			for (let op = 0; op < opCount; op++) {
				const r = rand();
				if (r < 0.6 || offs.length === 0) {
					const id = `n${op}`;
					const off = stack.push(entry(id));
					offs.push({ id, off });
					expected.push(id);
				} else {
					// Unsubscribe a random entry — exercise out-of-order pops.
					const pickIdx = Math.floor(rand() * offs.length);
					const picked = offs.splice(pickIdx, 1)[0];
					if (picked) {
						picked.off();
						const expIdx = expected.indexOf(picked.id);
						if (expIdx >= 0) expected.splice(expIdx, 1);
					}
				}
				const peeked = stack.peek();
				const top = expected.length === 0 ? null : (expected[expected.length - 1] as string);
				if (top === null) {
					expect(peeked).toBe(null);
				} else {
					expect(peeked?.id).toBe(top);
				}
				expect(stack.size()).toBe(expected.length);
			}
		}
	});
});

describe("applyEscape", () => {
	it("returns false on empty stack", () => {
		expect(applyEscape(createFocusTrapStack())).toBe(false);
	});

	it("invokes top's onEscape but does NOT pop — host owns removal via the unsubscribe returned from push()", () => {
		const s = createFocusTrapStack();
		const fnA = vi.fn();
		const fnB = vi.fn();
		s.push(entry("a", fnA));
		s.push(entry("b", fnB));
		expect(applyEscape(s)).toBe(true);
		expect(fnB).toHaveBeenCalledTimes(1);
		expect(fnA).not.toHaveBeenCalled();
		expect(s.size()).toBe(2);
		expect(s.peek()?.id).toBe("b");
	});

	it("a host that closes via its push-returned off() ends with the top removed and parent restored", () => {
		const s = createFocusTrapStack();
		const fnA = vi.fn();
		s.push(entry("a", fnA));
		let offB: () => void = () => {};
		const fnB = vi.fn(() => offB());
		offB = s.push(entry("b", fnB));
		expect(applyEscape(s)).toBe(true);
		expect(fnB).toHaveBeenCalledTimes(1);
		expect(s.size()).toBe(1);
		expect(s.peek()?.id).toBe("a");
	});

	it("a host that vetoes (does not call its off()) keeps the stack consistent — next Escape re-targets the same modal", () => {
		const s = createFocusTrapStack();
		const fnB = vi.fn();
		s.push(entry("a"));
		s.push(entry("b", fnB));
		expect(applyEscape(s)).toBe(true);
		expect(applyEscape(s)).toBe(true);
		expect(fnB).toHaveBeenCalledTimes(2);
		expect(s.size()).toBe(2);
	});

	it("a throwing onEscape leaves the stack intact (no half-applied pop) so the caller can retry or surface the error", () => {
		const s = createFocusTrapStack();
		s.push(entry("a"));
		s.push(
			entry("b", () => {
				throw new Error("boom");
			}),
		);
		expect(() => applyEscape(s)).toThrow("boom");
		expect(s.size()).toBe(2);
		expect(s.peek()?.id).toBe("b");
	});
});

describe("out-of-order unmount leaves top intact", () => {
	it("popping a middle entry preserves the topmost", () => {
		const s = createFocusTrapStack();
		s.push(entry("a"));
		const offB = s.push(entry("b"));
		s.push(entry("c"));
		offB();
		expect(s.size()).toBe(2);
		expect(s.peek()?.id).toBe("c");
		expect(s.popTop()?.id).toBe("c");
		expect(s.popTop()?.id).toBe("a");
	});
});
