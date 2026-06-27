import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { RelaySurface } from "../sync/relay-port";
import { MemoryAssetCas } from "./asset-cas";
import { serveAssetRequest } from "./asset-wire";
import { relayAssetCas } from "./relay-asset-cas";

const HASH = "c0ffee00".repeat(8);

/** A minimal surface — only `requestAsset` matters here; back it with the
 *  node-side responder over an in-memory CAS (the loopback a real node serves). */
function surfaceWithNode(): { surface: RelaySurface; node: MemoryAssetCas } {
	const node = new MemoryAssetCas();
	const surface = {
		currentPort: () => ({}) as never,
		onFrame: () => {},
		offFrame: () => {},
		requestAsset: (frame: Uint8Array) => serveAssetRequest(node, frame),
	} as unknown as RelaySurface;
	return { surface, node };
}

describe("relayAssetCas", () => {
	it("returns null when the surface has no asset transport", () => {
		const surface = {
			currentPort: () => ({}) as never,
			onFrame: () => {},
			offFrame: () => {},
		} as unknown as RelaySurface;
		expect(relayAssetCas(surface)).toBeNull();
	});

	it("round-trips has/put/get through the live surface's asset channel", async () => {
		const { surface, node } = surfaceWithNode();
		const cas = relayAssetCas(surface);
		expect(cas).not.toBeNull();
		if (!cas) return;
		const chunk = new Uint8Array(randomBytes(1500));
		expect(await cas.has(HASH)).toBe(false);
		await cas.put(HASH, chunk);
		expect(await node.has(HASH)).toBe(true);
		expect(await cas.has(HASH)).toBe(true);
		const got = await cas.get(HASH);
		expect(got && Buffer.from(got).equals(Buffer.from(chunk))).toBe(true);
		expect(await cas.get("f".repeat(64))).toBeNull();
	});
});
