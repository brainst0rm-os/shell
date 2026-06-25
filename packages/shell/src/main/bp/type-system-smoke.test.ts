/**
 * OQ-BP-1 resolution — `@blockprotocol/type-system` smoke test.
 *
 * The package ships a Rust→WASM core (`dist/wasm/type-system.wasm`)
 * loaded via an ES module bootstrap (`dist/es/main.js`). The question
 * (OQ-BP-1, filed at the 9.3.3.1 plan): does the WASM instantiate in
 * the shell-MAIN context, or do we need to push validation into the
 * dashboard renderer over an IPC hop?
 *
 * This test runs under vitest + bun — the same Node-compatible runtime
 * Electron-main hosts. If the package loads + `validateVersionedUrl`
 * returns a usable `Result` here, the same code path works main-side.
 * If this test fails, OQ-BP-1 resolves the other way (route validation
 * through a renderer worker) and the graph-router's `createEntity` /
 * `updateEntity` paths skip type-system validation main-side.
 */

import { describe, expect, it } from "vitest";

describe("OQ-BP-1 — @blockprotocol/type-system WASM in the shell-main runtime", () => {
	it("loads under bun + instantiates the WASM validator", async () => {
		// Dynamic import so a load failure surfaces as a test fail, not a
		// suite-import crash that masks the cause.
		const mod = await import("@blockprotocol/type-system");
		expect(typeof mod.validateVersionedUrl).toBe("function");
		expect(typeof mod.validateBaseUrl).toBe("function");
	});

	it("validateVersionedUrl accepts a well-formed BP versioned URL", async () => {
		const { validateVersionedUrl } = await import("@blockprotocol/type-system");
		const ok = validateVersionedUrl(
			"https://blockprotocol.org/@blockprotocol/types/entity-type/thing/v/1",
		);
		expect(ok.type).toBe("Ok");
	});

	it("validateVersionedUrl rejects a malformed URL", async () => {
		const { validateVersionedUrl } = await import("@blockprotocol/type-system");
		const err = validateVersionedUrl("not-a-url");
		expect(err.type).toBe("Err");
	});

	it("validateBaseUrl accepts a trailing-slash base URL", async () => {
		const { validateBaseUrl } = await import("@blockprotocol/type-system");
		const ok = validateBaseUrl("https://blockprotocol.org/@example/types/entity-type/test/");
		expect(ok.type).toBe("Ok");
	});

	it("validateBaseUrl rejects a non-trailing-slash URL", async () => {
		const { validateBaseUrl } = await import("@blockprotocol/type-system");
		const err = validateBaseUrl("https://blockprotocol.org/@example/types/entity-type/test");
		expect(err.type).toBe("Err");
	});
});
