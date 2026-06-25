// @vitest-environment jsdom
/**
 * Pins the `uploadFiles` flow added in plan iteration `9.8.5` (the real
 * half of the former ◑ create-flow upload).
 *
 * Boots `useFilesStore` with a mocked `window.brainstorm.services.files`,
 * triggers `uploadFiles`, and asserts:
 *   - the picker is called with `multi: true` + a localized title
 *   - each picked handle's bytes are read via `files.read`
 *   - one `brainstorm/File/v1` entity is created per picked file with
 *     real `name` / `mime` / `size` / `hash`
 *   - name collisions in the active folder rename to `stem (N).ext`
 *   - user-cancel (`requestOpen` returns `[]`) is a no-op, not an error
 *   - missing `services.files` (non-Electron / preview path) is a no-op
 */

import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFilesStore } from "../src/store/use-files-store";
import { FILE_TYPE } from "../src/types/entity";

type Probe = { store: ReturnType<typeof useFilesStore> | null };

function mount(probe: Probe): { root: Root } {
	const el = document.createElement("div");
	document.body.appendChild(el);
	const root = createRoot(el);
	function Harness() {
		probe.store = useFilesStore();
		return null;
	}
	act(() => {
		root.render(<Harness />);
	});
	return { root };
}

function stampRuntime(svc: {
	requestOpen: ReturnType<typeof vi.fn>;
	read: ReturnType<typeof vi.fn>;
}): void {
	(window as unknown as { brainstorm: unknown }).brainstorm = {
		app: { id: "io.brainstorm.files", version: "0.1.0", sdkVersion: "1" },
		capabilities: ["files.read"],
		services: { files: svc },
	};
}

function clearRuntime(): void {
	(window as unknown as { brainstorm: unknown }).brainstorm = undefined;
}

let probe: Probe;

beforeEach(() => {
	probe = { store: null };
});

afterEach(() => {
	clearRuntime();
	document.body.innerHTML = "";
});

describe("useFilesStore.uploadFiles (9.8.5)", () => {
	it("creates one File/v1 per picked OS file with real name/mime/size/hash", async () => {
		const bytesA = new TextEncoder().encode("hello world");
		const bytesB = new TextEncoder().encode("{}");
		const requestOpen = vi.fn().mockResolvedValue([
			{ handleId: "h-a", displayName: "notes.txt" },
			{ handleId: "h-b", displayName: "data.json" },
		]);
		const read = vi
			.fn()
			.mockImplementation(async (h: { handleId: string }) => (h.handleId === "h-a" ? bytesA : bytesB));
		stampRuntime({ requestOpen, read });

		const { root } = mount(probe);
		await act(async () => {
			await probe.store?.uploadFiles();
		});

		const tree = probe.store?.tree;
		expect(tree).toBeDefined();
		const files = tree?.list().filter((e) => e.type === FILE_TYPE) ?? [];
		expect(files).toHaveLength(2);

		const txt = files.find((e) => e.properties.name === "notes.txt");
		expect(txt).toBeDefined();
		expect(txt?.properties.mime).toBe("text/plain");
		expect(txt?.properties.size).toBe(bytesA.byteLength);
		expect(typeof txt?.properties.hash).toBe("string");
		expect((txt?.properties.hash as string).length).toBe(64);

		const json = files.find((e) => e.properties.name === "data.json");
		expect(json).toBeDefined();
		expect(json?.properties.mime).toBe("application/json");
		expect(json?.properties.size).toBe(bytesB.byteLength);

		expect(requestOpen).toHaveBeenCalledTimes(1);
		const opts = requestOpen.mock.calls[0]?.[0] as { title?: string; multi?: boolean };
		expect(opts.multi).toBe(true);
		expect(typeof opts.title).toBe("string");
		expect((opts.title ?? "").length).toBeGreaterThan(0);
		expect(read).toHaveBeenCalledTimes(2);

		act(() => root.unmount());
	});

	it("renames `name.ext` → `name (N).ext` when the active folder already has that name", async () => {
		const requestOpen = vi
			.fn()
			.mockResolvedValueOnce([{ handleId: "h-1", displayName: "report.pdf" }])
			.mockResolvedValueOnce([{ handleId: "h-2", displayName: "report.pdf" }]);
		const read = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
		stampRuntime({ requestOpen, read });

		const { root } = mount(probe);
		await act(async () => {
			await probe.store?.uploadFiles();
		});
		await act(async () => {
			await probe.store?.uploadFiles();
		});

		const names = probe.store?.tree
			.list()
			.filter((e) => e.type === FILE_TYPE)
			.map((e) => e.properties.name as string)
			.sort();
		expect(names).toEqual(["report (2).pdf", "report.pdf"]);

		act(() => root.unmount());
	});

	it("treats a cancelled picker (`[]`) as a no-op, not an error", async () => {
		const requestOpen = vi.fn().mockResolvedValue([]);
		const read = vi.fn();
		stampRuntime({ requestOpen, read });

		const { root } = mount(probe);
		await act(async () => {
			await probe.store?.uploadFiles();
		});

		const files = probe.store?.tree.list().filter((e) => e.type === FILE_TYPE) ?? [];
		expect(files).toHaveLength(0);
		expect(read).not.toHaveBeenCalled();

		act(() => root.unmount());
	});

	it("is a no-op when services.files is not exposed (non-Electron / preview path)", async () => {
		clearRuntime();
		const { root } = mount(probe);
		await act(async () => {
			await probe.store?.uploadFiles();
		});

		const files = probe.store?.tree.list().filter((e) => e.type === FILE_TYPE) ?? [];
		expect(files).toHaveLength(0);

		act(() => root.unmount());
	});

	it("`newFile` is the back-compat alias for `uploadFiles` (app.tsx menu wiring)", () => {
		const { root } = mount(probe);
		expect(probe.store?.newFile).toBe(probe.store?.uploadFiles);
		act(() => root.unmount());
	});
});

/** Runtime stamp for the blob-store paths (9.8.5 second half + 9.8.15):
 *  `files.import` + the `entities.create`/`update` persistence seam. */
function stampImportRuntime(overrides: {
	requestOpen?: ReturnType<typeof vi.fn>;
	importFn?: ReturnType<typeof vi.fn>;
	create?: ReturnType<typeof vi.fn>;
	update?: ReturnType<typeof vi.fn>;
}): {
	importFn: ReturnType<typeof vi.fn>;
	create: ReturnType<typeof vi.fn>;
	update: ReturnType<typeof vi.fn>;
} {
	const importFn =
		overrides.importFn ??
		vi
			.fn()
			.mockImplementation(async (input: { handle?: { displayName: string }; name?: string }) => ({
				assetId: "asset-1",
				contentHash: "c".repeat(64),
				size: 7,
				mime: "image/png",
				name: input.handle?.displayName ?? input.name ?? "",
			}));
	const create = overrides.create ?? vi.fn().mockResolvedValue({});
	const update = overrides.update ?? vi.fn().mockResolvedValue({});
	(window as unknown as { brainstorm: unknown }).brainstorm = {
		app: { id: "io.brainstorm.files", version: "0.1.0", sdkVersion: "1" },
		capabilities: ["files.read"],
		services: {
			files: {
				requestOpen: overrides.requestOpen ?? vi.fn().mockResolvedValue([]),
				read: vi.fn().mockRejectedValue(new Error("legacy read must not run when import exists")),
				import: importFn,
			},
			entities: { create, update },
		},
	};
	return { importFn, create, update };
}

describe("useFilesStore upload via files.import (blob-store half)", () => {
	it("picker flow: seals bytes shell-side, stamps assetId/assetMime, persists via entities.create", async () => {
		const requestOpen = vi.fn().mockResolvedValue([{ handleId: "h-1", displayName: "photo.png" }]);
		const { importFn, create, update } = stampImportRuntime({ requestOpen });

		const { root } = mount(probe);
		await act(async () => {
			await probe.store?.uploadFiles();
		});

		expect(importFn).toHaveBeenCalledTimes(1);
		expect(importFn.mock.calls[0]?.[0]).toEqual({
			handle: { handleId: "h-1", displayName: "photo.png" },
		});

		const files = probe.store?.tree.list().filter((e) => e.type === FILE_TYPE) ?? [];
		expect(files).toHaveLength(1);
		const file = files[0];
		expect(file?.properties.assetId).toBe("asset-1");
		expect(file?.properties.assetMime).toBe("image/png");
		expect(file?.properties.hash).toBe("c".repeat(64));
		expect(file?.properties.size).toBe(7);

		// The row persists with the SAME optimistic id, and the parent's
		// membership writes through once for the batch.
		expect(create).toHaveBeenCalledTimes(1);
		expect(create).toHaveBeenCalledWith(FILE_TYPE, file?.properties, file?.id);
		expect(update).toHaveBeenCalledTimes(1);

		act(() => root.unmount());
	});

	it("drag-in flow (uploadDroppedFiles): bytes variant of files.import + the same persistence", async () => {
		const { importFn, create } = stampImportRuntime({});

		const { root } = mount(probe);
		const dropped = new File([new Uint8Array([1, 2, 3])], "dropped.png", { type: "image/png" });
		await act(async () => {
			await probe.store?.uploadDroppedFiles([dropped]);
		});

		expect(importFn).toHaveBeenCalledTimes(1);
		const arg = importFn.mock.calls[0]?.[0] as { name: string; bytes: Uint8Array };
		expect(arg.name).toBe("dropped.png");
		expect(Array.from(arg.bytes)).toEqual([1, 2, 3]);

		const files = probe.store?.tree.list().filter((e) => e.type === FILE_TYPE) ?? [];
		expect(files).toHaveLength(1);
		expect(files[0]?.properties.assetId).toBe("asset-1");
		expect(create).toHaveBeenCalledTimes(1);

		act(() => root.unmount());
	});

	it("drag-in without files.import (older shell / preview) is a graceful no-op", async () => {
		stampRuntime({ requestOpen: vi.fn(), read: vi.fn() }); // no `import`

		const { root } = mount(probe);
		const dropped = new File([new Uint8Array([1])], "x.txt", { type: "text/plain" });
		await act(async () => {
			await probe.store?.uploadDroppedFiles([dropped]);
		});

		const files = probe.store?.tree.list().filter((e) => e.type === FILE_TYPE) ?? [];
		expect(files).toHaveLength(0);

		act(() => root.unmount());
	});

	it("a failing import skips that file and continues the batch", async () => {
		const requestOpen = vi.fn().mockResolvedValue([
			{ handleId: "h-bad", displayName: "bad.bin" },
			{ handleId: "h-good", displayName: "good.txt" },
		]);
		const importFn = vi
			.fn()
			.mockImplementation(async (input: { handle: { handleId: string; displayName: string } }) => {
				if (input.handle.handleId === "h-bad") throw new Error("disk full");
				return {
					assetId: "asset-2",
					contentHash: "d".repeat(64),
					size: 4,
					mime: "text/plain",
					name: input.handle.displayName,
				};
			});
		stampImportRuntime({ requestOpen, importFn });

		const { root } = mount(probe);
		await act(async () => {
			await probe.store?.uploadFiles();
		});

		const names = probe.store?.tree
			.list()
			.filter((e) => e.type === FILE_TYPE)
			.map((e) => e.properties.name);
		expect(names).toEqual(["good.txt"]);

		act(() => root.unmount());
	});
});
