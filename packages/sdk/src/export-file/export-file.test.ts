// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
	SaveDispositionKind,
	type SaveFileService,
	type SaveFileTarget,
	failureDetail,
	requestSaveBytes,
	suggestedFilename,
	textToBytes,
} from "./index";

describe("textToBytes", () => {
	it("produces UTF-8 bytes that round-trip through TextDecoder", () => {
		const text = 'digraph G { "Привет" -> "Привіт 👋"; }';
		const bytes = textToBytes(text);
		// jsdom + Node use different `Uint8Array` realms so `instanceof`
		// trips even on a legit byte array; structural shape is the right
		// fence here (length + iterable-of-bytes).
		expect(ArrayBuffer.isView(bytes)).toBe(true);
		expect(bytes.constructor.name).toBe("Uint8Array");
		expect(new TextDecoder("utf-8").decode(bytes)).toBe(text);
	});

	it("empty input → zero-length array (not null/undefined)", () => {
		const bytes = textToBytes("");
		// jsdom + Node use different `Uint8Array` realms so `instanceof`
		// trips even on a legit byte array; structural shape is the right
		// fence here (length + iterable-of-bytes).
		expect(ArrayBuffer.isView(bytes)).toBe(true);
		expect(bytes.constructor.name).toBe("Uint8Array");
		expect(bytes.length).toBe(0);
	});

	it("returns a fresh Uint8Array each call (no shared mutable buffer)", () => {
		const a = textToBytes("hello");
		const b = textToBytes("hello");
		expect(a).not.toBe(b);
		a[0] = 0;
		expect(b[0]).not.toBe(0);
	});
});

describe("suggestedFilename", () => {
	it("composes `<stem>.<extension>` when stem is clean", () => {
		expect(suggestedFilename("Quarterly Review", "json")).toBe("Quarterly Review.json");
		expect(suggestedFilename("Q3", "png")).toBe("Q3.png");
	});

	it("falls back to `untitled.<ext>` when stem is null / undefined / empty / whitespace", () => {
		expect(suggestedFilename(null, "svg")).toBe("untitled.svg");
		expect(suggestedFilename(undefined, "dot")).toBe("untitled.dot");
		expect(suggestedFilename("", "json")).toBe("untitled.json");
		expect(suggestedFilename("   ", "graphml")).toBe("untitled.graphml");
	});

	it("honours a domain-specific defaultStem", () => {
		expect(suggestedFilename(null, "svg", { defaultStem: "graph" })).toBe("graph.svg");
		expect(suggestedFilename("", "png", { defaultStem: "board" })).toBe("board.png");
	});

	it("replaces every filesystem-hostile char with underscore", () => {
		const dirty = 'a/b\\c:d*e?f"g<h>i|j\nk\rl\tm';
		const safe = suggestedFilename(dirty, "json");
		expect(safe.endsWith(".json")).toBe(true);
		for (const ch of ["/", "\\", ":", "*", "?", '"', "<", ">", "|", "\n", "\r", "\t"]) {
			expect(safe).not.toContain(ch);
		}
	});

	it("caps the stem at 96 chars even for extreme-long input", () => {
		const out = suggestedFilename("x".repeat(500), "json");
		expect(out.length).toBe(96 + 1 + 4); // 96 stem + dot + ext
		expect(out.endsWith(".json")).toBe(true);
	});
});

describe("requestSaveBytes", () => {
	const noopHandle: SaveFileTarget = {
		handleId: "h_test",
		displayName: "out.json",
	};

	function makeService(overrides?: Partial<SaveFileService>): SaveFileService {
		return {
			requestSave: vi.fn(async () => noopHandle),
			write: vi.fn(async () => {}),
			...overrides,
		};
	}

	it("Saved disposition when the dialog returns a handle and write succeeds", async () => {
		const files = makeService();
		const result = await requestSaveBytes(files, {
			suggestedName: "out.json",
			filters: [{ name: "JSON", extensions: ["json"] }],
			encode: () => textToBytes("{}"),
		});
		expect(result.kind).toBe(SaveDispositionKind.Saved);
		if (result.kind === SaveDispositionKind.Saved) {
			expect(result.handle).toBe(noopHandle);
		}
		expect(files.requestSave).toHaveBeenCalledWith({
			suggestedName: "out.json",
			filters: [{ name: "JSON", extensions: ["json"] }],
		});
		expect(files.write).toHaveBeenCalledTimes(1);
	});

	it("Cancelled disposition when requestSave returns null — encode is NEVER called", async () => {
		// The cancellation contract is the load-bearing optimisation: PNG
		// raster (potentially expensive) must not run if the user clicked
		// Cancel in the picker. A regression would burn CPU on every
		// cancelled save.
		const encode = vi.fn(() => textToBytes("payload"));
		const files = makeService({ requestSave: vi.fn(async () => null) });
		const result = await requestSaveBytes(files, {
			suggestedName: "out.json",
			filters: [{ name: "JSON", extensions: ["json"] }],
			encode,
		});
		expect(result.kind).toBe(SaveDispositionKind.Cancelled);
		expect(encode).not.toHaveBeenCalled();
		expect(files.write).not.toHaveBeenCalled();
	});

	it("Failed disposition when encoder throws — write is not attempted", async () => {
		const boom = new Error("encode failed");
		const files = makeService();
		const result = await requestSaveBytes(files, {
			suggestedName: "out.json",
			filters: [{ name: "JSON", extensions: ["json"] }],
			encode: () => {
				throw boom;
			},
		});
		expect(result.kind).toBe(SaveDispositionKind.Failed);
		if (result.kind === SaveDispositionKind.Failed) {
			expect(result.error).toBe(boom);
		}
		expect(files.write).not.toHaveBeenCalled();
	});

	it("Failed disposition when write rejects", async () => {
		const boom = new Error("disk full");
		const files = makeService({ write: vi.fn(async () => Promise.reject(boom)) });
		const result = await requestSaveBytes(files, {
			suggestedName: "out.json",
			filters: [{ name: "JSON", extensions: ["json"] }],
			encode: () => textToBytes("{}"),
		});
		expect(result.kind).toBe(SaveDispositionKind.Failed);
		if (result.kind === SaveDispositionKind.Failed) {
			expect(result.error).toBe(boom);
		}
	});

	it("Failed disposition when requestSave rejects (e.g. no vault session)", async () => {
		const boom = new Error("Unavailable");
		const files = makeService({ requestSave: vi.fn(async () => Promise.reject(boom)) });
		const result = await requestSaveBytes(files, {
			suggestedName: "out.json",
			filters: [{ name: "JSON", extensions: ["json"] }],
			encode: () => textToBytes("{}"),
		});
		expect(result.kind).toBe(SaveDispositionKind.Failed);
	});

	it("passes the optional title through to requestSave (when set) and omits it (when not)", async () => {
		// `exactOptionalPropertyTypes` cares: `title: undefined` would
		// re-introduce the key with a sentinel value into the call, which
		// looks structurally different to the broker. The orchestrator
		// must omit the key entirely when the caller didn't pass one.
		const fA = makeService();
		await requestSaveBytes(fA, {
			suggestedName: "x.json",
			filters: [{ name: "JSON", extensions: ["json"] }],
			title: "Save graph",
			encode: () => textToBytes("{}"),
		});
		expect(fA.requestSave).toHaveBeenCalledWith({
			suggestedName: "x.json",
			filters: [{ name: "JSON", extensions: ["json"] }],
			title: "Save graph",
		});

		const fB = makeService();
		await requestSaveBytes(fB, {
			suggestedName: "x.json",
			filters: [{ name: "JSON", extensions: ["json"] }],
			encode: () => textToBytes("{}"),
		});
		const lastCall = (fB.requestSave as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
		expect(lastCall).toBeDefined();
		expect(Object.hasOwn(lastCall, "title")).toBe(false);
	});
});

describe("failureDetail", () => {
	it("returns Error.message when given an Error", () => {
		expect(failureDetail(new Error("boom"))).toBe("boom");
	});

	it("stringifies non-Error values (string, number, null, object)", () => {
		expect(failureDetail("raw")).toBe("raw");
		expect(failureDetail(42)).toBe("42");
		expect(failureDetail(null)).toBe("null");
		expect(failureDetail({ kind: "x" })).toBe("[object Object]");
	});
});
