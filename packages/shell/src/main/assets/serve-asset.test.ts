/**
 * resolveAssetForServe — the `brainstorm://asset/<id>` validation + fail-
 * closed posture:
 *   - a valid id with a stored asset serves its bytes + mime;
 *   - a non-UUID id (traversal / uppercase / wrong shape) → 400 (never
 *     reaches the store);
 *   - an unknown asset → 404;
 *   - a store throw (tampered blob / wrong key) → 404, never an error leak.
 */

import { describe, expect, it } from "vitest";
import { type AssetReader, resolveAssetForServe } from "./serve-asset";

const VALID_ID = "0123abcd-4567-89ab-cdef-0123456789ab";

function reader(impl: AssetReader["readAsset"]): AssetReader {
	return { readAsset: impl };
}

describe("resolveAssetForServe", () => {
	it("serves a stored asset's bytes + mime", async () => {
		const bytes = new Uint8Array([1, 2, 3]);
		const result = await resolveAssetForServe(
			reader(async () => ({ bytes, mime: "image/png" })),
			VALID_ID,
		);
		expect(result).toEqual({ ok: true, mime: "image/png", bytes });
	});

	it("rejects a non-UUID id with 400 without touching the store", async () => {
		let touched = false;
		const store = reader(async () => {
			touched = true;
			return null;
		});
		for (const bad of [
			"../../etc/passwd",
			"ABCDEF",
			"not-a-uuid",
			`../${VALID_ID}`,
			`${VALID_ID}/x`,
		]) {
			expect(await resolveAssetForServe(store, bad)).toEqual({ ok: false, status: 400 });
		}
		expect(touched).toBe(false);
	});

	it("returns 404 for an unknown asset", async () => {
		const result = await resolveAssetForServe(
			reader(async () => null),
			VALID_ID,
		);
		expect(result).toEqual({ ok: false, status: 404 });
	});

	it("fails closed (404) when the store throws (tampered / wrong key)", async () => {
		const result = await resolveAssetForServe(
			reader(async () => {
				throw new Error("AEAD tag mismatch");
			}),
			VALID_ID,
		);
		expect(result).toEqual({ ok: false, status: 404 });
	});
});
