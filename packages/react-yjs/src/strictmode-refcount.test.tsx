// @vitest-environment jsdom
/**
 * Invariant guard: under React StrictMode (dev), `useResolvedDoc` must keep
 * resolver refcounts balanced — every entity `resolve()` a render performs is
 * matched by an effective `release()`, so the entity's internal refcount
 * returns to 0 and the entry is freed/retained for revival.
 *
 * This WAS the "navigate-back-blank" bug (2026-06-17). StrictMode double-
 * invokes a `useMemo` factory; the old `useResolvedDoc` acquired its handle
 * inside the factory, so `resolve()` (impure — it bumps the entity refcount)
 * ran twice while only the last handle got a cleanup effect. The discarded
 * handle's ref leaked, pinning the entry in the live map; reopening then
 * REUSED the already-populated doc and a fresh `@lexical/yjs` binding rendered
 * blank (refs climbed 9→14 in the field). The fix dedupes acquisition through
 * a ref so the factory takes exactly one refcount. NB: count only EFFECTIVE
 * releases (idempotent re-releases of an already-freed handle don't free
 * anything) — counting raw calls hid the leak behind StrictMode's double
 * cleanup of the kept handle.
 */

import { StrictMode, act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useYDoc, useYDocApplyPending, useYDocLoaded } from "./hooks";
import { YDocProvider } from "./provider";
import { type YDocResolverApi, createYDocResolver } from "./resolver";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

/** Wrap a resolver so we can count resolve() / release() across a mount. */
function countingResolver(): {
	api: YDocResolverApi;
	counts: { resolves: number; releases: number };
} {
	const inner = createYDocResolver({
		load: async () => null,
		persist: () => {},
		release: () => {},
	});
	const counts = { resolves: 0, releases: 0 };
	const api: YDocResolverApi = {
		...inner,
		resolve: (id) => {
			counts.resolves += 1;
			const h = inner.resolve(id);
			// Count only the EFFECTIVE release. StrictMode invokes an effect's
			// cleanup more than once for the same handle; the handle's release is
			// idempotent (frees the ref once), so counting raw calls would mask a
			// leak behind a double cleanup. Mirror the idempotency here.
			let freed = false;
			return {
				...h,
				release: () => {
					if (freed) return;
					freed = true;
					counts.releases += 1;
					h.release();
				},
			};
		},
	};
	return { api, counts };
}

// Mirrors how the Notes <Editor> resolves: three hooks for the same id.
function Editorish({ id }: { id: string }) {
	useYDoc(id);
	useYDocLoaded(id);
	useYDocApplyPending(id);
	return null;
}

describe("useResolvedDoc under StrictMode", () => {
	it("balances resolve()/release() across a mount + unmount (no refcount leak)", async () => {
		const { api, counts } = countingResolver();
		await act(async () => {
			root.render(
				<StrictMode>
					<YDocProvider resolver={api.resolve}>
						<Editorish id="A" />
					</YDocProvider>
				</StrictMode>,
			);
		});
		await act(async () => root.unmount());
		// Re-render a no-op so the afterEach unmount is clean.
		container = document.createElement("div");
		root = createRoot(container);

		expect(counts.releases, `resolves=${counts.resolves} releases=${counts.releases}`).toBe(
			counts.resolves,
		);
	});
});
