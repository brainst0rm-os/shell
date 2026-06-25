import { describe, expect, it } from "vitest";
import { canRedo, canUndo, initialHistory, pushHistory, redo, undo } from "./history";

describe("history", () => {
	it("seeds with the initial present and can't undo/redo", () => {
		const h = initialHistory("a");
		expect(h.stack).toEqual(["a"]);
		expect(canUndo(h)).toBe(false);
		expect(canRedo(h)).toBe(false);
	});

	it("push → undo → redo walks the snapshots", () => {
		let h = initialHistory("a");
		h = pushHistory(h, "b");
		h = pushHistory(h, "c");
		expect(canUndo(h)).toBe(true);

		const u1 = undo(h);
		expect(u1?.present).toBe("b");
		h = u1?.history ?? h;
		const u2 = undo(h);
		expect(u2?.present).toBe("a");
		h = u2?.history ?? h;
		expect(canUndo(h)).toBe(false);
		expect(undo(h)).toBeNull();

		const r1 = redo(h);
		expect(r1?.present).toBe("b");
	});

	it("a push after undo truncates the redo tail", () => {
		let h = initialHistory("a");
		h = pushHistory(h, "b");
		h = pushHistory(h, "c");
		h = undo(h)?.history ?? h; // present = b
		h = pushHistory(h, "d"); // branches off b
		expect(h.stack).toEqual(["a", "b", "d"]);
		expect(canRedo(h)).toBe(false);
		expect(undo(h)?.present).toBe("b");
	});

	it("caps the stack, dropping the oldest", () => {
		let h = initialHistory(0);
		for (let i = 1; i <= 5; i++) h = pushHistory(h, i, 3);
		expect(h.stack).toEqual([3, 4, 5]);
		expect(h.index).toBe(2);
		expect(undo(h)?.present).toBe(4);
	});

	it("re-pushing the identical present is a no-op", () => {
		let h = initialHistory("a");
		h = pushHistory(h, "b");
		const same = pushHistory(h, h.stack[h.index] as string);
		expect(same).toBe(h);
	});
});
