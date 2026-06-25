import { describe, expect, it, vi } from "vitest";
import type { PreviewFile } from "../demo/dataset";
import { PreviewContextKind } from "../types/preview-context";
import { resolveOpenPayload, toPreviewFiles } from "./apply-open";

function file(id: string): PreviewFile {
	return {
		id,
		info: { name: `${id}.txt`, mime: "text/plain", sizeBytes: 1, modifiedAt: null },
		source: { kind: "url", url: `brainstorm://file/${id}`, mime: "text/plain", sizeBytes: 1 },
	};
}

const noResolve = async () => null;

describe("toPreviewFiles", () => {
	it("dedupes by id and coerces missing numerics to null", () => {
		const files = toPreviewFiles([
			{ id: "a", name: "a.txt", mime: "text/plain", url: "u-a" },
			{ id: "a", name: "dup", mime: "text/plain", url: "u-a2" },
			{ id: "", name: "skip", mime: "text/plain", url: "u" },
		]);
		expect(files).toHaveLength(1);
		expect(files[0]?.info.sizeBytes).toBeNull();
		expect(files[0]?.info.modifiedAt).toBeNull();
	});
});

describe("resolveOpenPayload", () => {
	it("is a no-op for a payload with neither id nor context", async () => {
		expect(await resolveOpenPayload({}, [], noResolve)).toBeNull();
	});

	it("focuses within the current set without resolving when the id is present", async () => {
		const resolve = vi.fn(noResolve);
		const next = await resolveOpenPayload({ entityId: "b" }, [file("a"), file("b")], resolve);
		expect(resolve).not.toHaveBeenCalled();
		expect(next).toEqual({ context: null, siblings: expect.any(Array), focusId: "b" });
	});

	it("resolves a bare id to a single file when it isn't in the current set", async () => {
		const resolve = vi.fn(async () => file("z"));
		const next = await resolveOpenPayload({ entityId: "z" }, [], resolve);
		expect(resolve).toHaveBeenCalledWith("z");
		expect(next?.context).toEqual({ kind: PreviewContextKind.Single });
		expect(next?.siblings).toHaveLength(1);
		expect(next?.focusId).toBe("z");
	});

	it("returns null when a bare id can't be resolved", async () => {
		expect(await resolveOpenPayload({ entityId: "missing" }, [], noResolve)).toBeNull();
	});

	it("builds the gallery from inlined siblings without resolving", async () => {
		const resolve = vi.fn(noResolve);
		const next = await resolveOpenPayload(
			{
				entityId: "b",
				context: { kind: PreviewContextKind.Folder, label: "Shots" },
				siblings: [
					{ id: "a", name: "a.txt", mime: "text/plain", url: "u-a" },
					{ id: "b", name: "b.txt", mime: "text/plain", url: "u-b" },
				],
			},
			[],
			resolve,
		);
		expect(resolve).not.toHaveBeenCalled();
		expect(next?.siblings).toHaveLength(2);
		expect(next?.focusId).toBe("b");
		expect(next?.context?.kind).toBe(PreviewContextKind.Folder);
	});
});
