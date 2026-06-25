/**
 * Stage 10.9a — canary-search helper for the ciphertext-only proof.
 *
 * The blind relay's audit-log records `{ts, fromConnId, toConnId, entityId,
 * kind, bytes}` per frame and is type-fenced against payload bytes (see
 * `packages/relay-server/src/audit-log.ts`). The soak harness plants a
 * known canary string per side into the typing load and, post-soak,
 * greps the on-disk audit log for any byte sequence matching either
 * canary. A non-empty match list = the relay (or its audit-log writer)
 * leaked plaintext — the ciphertext-only invariant has been breached.
 *
 * Robust against:
 *   - NDJSON framing — the relay writes one JSON object per line.
 *   - UTF-8 multibyte canaries — match runs byte-by-byte on the raw file
 *     buffer (no string decode), so a multibyte canary stays intact even
 *     if the audit-log writer happened to embed escaped sequences.
 *   - Very large logs — single linear pass; no regex, no per-line buffer.
 *
 * Intentionally *not* robust against:
 *   - Hex-encoded payload bytes. The audit log is type-fenced, so this
 *     code path doesn't exist; if a future leak introduced a hex-encoded
 *     payload field, the canary string itself wouldn't match its hex
 *     form. That class of leak is caught by a separate fence (the
 *     `AuditEntryInput` shape rejects payload-shaped fields at compile
 *     time; see `packages/relay-server/src/audit-log.ts`).
 */

import { readFile } from "node:fs/promises";

export type CanaryMatch = {
	readonly canary: string;
	readonly offset: number;
};

export async function searchCanariesInFile(
	auditLogPath: string,
	canaries: readonly string[],
): Promise<readonly CanaryMatch[]> {
	const buf = await readFile(auditLogPath);
	return searchCanariesInBuffer(buf, canaries);
}

export function searchCanariesInBuffer(
	buf: Uint8Array,
	canaries: readonly string[],
): readonly CanaryMatch[] {
	const matches: CanaryMatch[] = [];
	const encoder = new TextEncoder();
	for (const canary of canaries) {
		if (canary.length === 0) continue;
		const needle = encoder.encode(canary);
		let from = 0;
		while (from <= buf.length - needle.length) {
			const at = indexOfBytes(buf, needle, from);
			if (at < 0) break;
			matches.push({ canary, offset: at });
			from = at + 1;
		}
	}
	return matches;
}

function indexOfBytes(hay: Uint8Array, needle: Uint8Array, from: number): number {
	if (needle.length === 0) return -1;
	const lastStart = hay.length - needle.length;
	outer: for (let i = from; i <= lastStart; i++) {
		for (let j = 0; j < needle.length; j++) {
			if (hay[i + j] !== needle[j]) continue outer;
		}
		return i;
	}
	return -1;
}
