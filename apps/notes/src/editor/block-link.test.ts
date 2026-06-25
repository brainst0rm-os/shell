import { afterEach, describe, expect, it, vi } from "vitest";
import { copyBlockLink } from "./block-link";

afterEach(() => {
	vi.unstubAllGlobals();
});

function stubClipboard(writeText: (text: string) => Promise<void>): { calls: string[] } {
	const calls: string[] = [];
	vi.stubGlobal("navigator", {
		clipboard: {
			writeText: (text: string) => {
				calls.push(text);
				return writeText(text);
			},
		},
	});
	return { calls };
}

describe("copyBlockLink", () => {
	it("writes the anchored entity URI to the clipboard and resolves true", async () => {
		const { calls } = stubClipboard(() => Promise.resolve());

		const ok = await copyBlockLink("note-1", "block-key-7");

		expect(ok).toBe(true);
		expect(calls).toEqual(["brainstorm://entity/note-1#block-block-key-7"]);
	});

	it("returns false (no throw) when the Clipboard API is unavailable", async () => {
		vi.stubGlobal("navigator", {});

		await expect(copyBlockLink("note-1", "k1")).resolves.toBe(false);
	});

	it("returns false (no throw) when navigator is absent entirely", async () => {
		vi.stubGlobal("navigator", undefined);

		await expect(copyBlockLink("note-1", "k1")).resolves.toBe(false);
	});

	it("returns false when writeText rejects (denied permission)", async () => {
		const { calls } = stubClipboard(() => Promise.reject(new Error("denied")));

		const ok = await copyBlockLink("note-1", "k1");

		expect(ok).toBe(false);
		expect(calls).toEqual(["brainstorm://entity/note-1#block-k1"]);
	});

	it("degrades a fragment-breaking block id to the plain entity link", async () => {
		// `formatBrainstormEntityUri` drops an anchor carrying `#`/`?`/whitespace
		// rather than emitting an unparseable URI — copyBlockLink inherits that.
		const { calls } = stubClipboard(() => Promise.resolve());

		await copyBlockLink("note-1", "bad id#with space");

		expect(calls).toEqual(["brainstorm://entity/note-1"]);
	});
});
