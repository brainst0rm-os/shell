/**
 * Stage 10.9a — convergence helper for the soak harness.
 *
 * Reads the per-entity Y.Doc state vector from each shell via the
 * `bs.dev.getStateVector(entityId)` IPC bridge (dev-only, gated by
 * `BRAINSTORM_SOAK_DEBUG=1`). Equality of state vectors across two
 * peers is the canonical CRDT-convergence proof — same set of (clientId,
 * clock) pairs means no peer is missing any update from the other side.
 *
 * Returns `{equal, hex: {a, b}}` so the spec's assertion failure mode
 * prints the divergence rather than an opaque "bytes not equal".
 */

import type { Page } from "@playwright/test";

export type StateVectorComparison = {
	readonly equal: boolean;
	readonly hexA: string;
	readonly hexB: string;
};

export async function getStateVector(page: Page, entityId: string): Promise<Uint8Array> {
	const bytes = (await page.evaluate(async (id: string) => {
		const w = window as unknown as {
			brainstorm?: {
				dev?: {
					getStateVector?: (entityId: string) => Promise<Uint8Array | number[]>;
				};
			};
		};
		const fn = w.brainstorm?.dev?.getStateVector;
		if (!fn) throw new Error("bs.dev.getStateVector unavailable (BRAINSTORM_SOAK_DEBUG=1?)");
		const result = await fn(id);
		return Array.from(result as Iterable<number>);
	}, entityId)) as number[];
	return new Uint8Array(bytes);
}

export async function compareStateVectors(
	pageA: Page,
	pageB: Page,
	entityId: string,
): Promise<StateVectorComparison> {
	const [a, b] = await Promise.all([
		getStateVector(pageA, entityId),
		getStateVector(pageB, entityId),
	]);
	return {
		equal: bytesEqual(a, b),
		hexA: bytesToHex(a),
		hexB: bytesToHex(b),
	};
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

export function bytesToHex(b: Uint8Array): string {
	let out = "";
	for (let i = 0; i < b.length; i++) {
		const byte = b[i] ?? 0;
		out += byte.toString(16).padStart(2, "0");
	}
	return out;
}
