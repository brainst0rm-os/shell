import { describe, expect, it, vi } from "vitest";
import {
	type YDocResolverRuntime,
	b64ToBytes,
	bytesToB64,
	createYDocResolverAccessor,
} from "./resolver-accessor";

function fakeRuntime(): YDocResolverRuntime {
	return {
		services: {
			entities: {
				loadDoc: async () => ({ snapshotB64: null }),
				applyDoc: () => undefined,
				closeDoc: () => undefined,
			},
		},
		ydoc: { onRemote: () => () => {} },
	};
}

describe("createYDocResolverAccessor", () => {
	it("returns null when the runtime is absent", () => {
		expect(createYDocResolverAccessor(() => null)()).toBeNull();
	});

	it("returns null when the entities doc surface is missing", () => {
		const getApi = createYDocResolverAccessor(() => ({
			services: { entities: {} },
			ydoc: { onRemote: () => () => {} },
		}));
		expect(getApi()).toBeNull();
	});

	it("returns null when the ydoc bridge is missing", () => {
		const getApi = createYDocResolverAccessor(() => ({
			services: {
				entities: {
					loadDoc: async () => ({ snapshotB64: null }),
					applyDoc: () => undefined,
					closeDoc: () => undefined,
				},
			},
		}));
		expect(getApi()).toBeNull();
	});

	it("builds a resolver once and memoises it", () => {
		const getRuntime = vi.fn(fakeRuntime);
		const getApi = createYDocResolverAccessor(getRuntime);
		const a = getApi();
		const b = getApi();
		expect(a).not.toBeNull();
		expect(typeof a?.resolve).toBe("function");
		expect(a).toBe(b);
		// getRuntime is not consulted again once cached.
		expect(getRuntime).toHaveBeenCalledTimes(1);
	});
});

describe("base64 round-trip", () => {
	it("bytesToB64 ∘ b64ToBytes is identity", () => {
		const bytes = new Uint8Array([0, 1, 2, 250, 255, 128, 64]);
		expect([...b64ToBytes(bytesToB64(bytes))]).toEqual([...bytes]);
	});
});
