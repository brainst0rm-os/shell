/**
 * Stage 10.9a — vitest-unit tests for `canary-search`. Runs under the
 * workspace vitest suite (no Playwright, no Electron, no relay) so the
 * scanner contract is fenced independently of a real soak run.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { searchCanariesInBuffer, searchCanariesInFile } from "./canary-search";

describe("canary-search", () => {
	let tmpDir = "";
	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "bs-canary-"));
	});
	afterEach(async () => {
		if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
	});

	it("round-trip — finds a canary planted in the audit log", async () => {
		const file = join(tmpDir, "audit.log");
		const canary = "XYZHELLOZYX-A";
		await writeFile(
			file,
			`${JSON.stringify({ ts: 1, fromConnId: "a", toConnId: "b", entityId: canary, kind: "update", bytes: 64 })}\n`,
		);
		const matches = await searchCanariesInFile(file, [canary]);
		expect(matches.length).toBe(1);
		expect(matches[0]?.canary).toBe(canary);
	});

	it("false-positive resistance — random chunks don't match", () => {
		const rand = new Uint8Array(64 * 1024);
		for (let i = 0; i < rand.length; i++) rand[i] = (i * 31 + 7) & 0xff;
		const matches = searchCanariesInBuffer(rand, ["XYZHELLOZYX-A", "QPRWORLDRPQ-B"]);
		expect(matches.length).toBe(0);
	});

	it("hex-encoding edge cases — string-canary doesn't match its hex form", () => {
		const canary = "DEADBEEF";
		const hex = "44454144424545460a".repeat(4);
		const buf = new TextEncoder().encode(hex);
		const matches = searchCanariesInBuffer(buf, [canary]);
		expect(matches.length).toBe(0);
	});

	it("multibyte canary — UTF-8 sequences match by raw byte slice", () => {
		const canary = "üñîçødé-canary-Ω";
		const buf = new TextEncoder().encode(`leading ${canary} trailing\n`);
		const matches = searchCanariesInBuffer(buf, [canary]);
		expect(matches.length).toBe(1);
	});

	it("empty log returns empty matches", async () => {
		const file = join(tmpDir, "empty.log");
		await writeFile(file, "");
		const matches = await searchCanariesInFile(file, ["any"]);
		expect(matches.length).toBe(0);
	});

	it("large log (1MB+) completes fast + matches only at planted offsets", () => {
		const canary = "QPRWORLDRPQ-B";
		const chunk = new Uint8Array(1024 * 1024);
		for (let i = 0; i < chunk.length; i++) chunk[i] = 32 + (i & 0x3f);
		const planted = new TextEncoder().encode(canary);
		const at = 800_000;
		chunk.set(planted, at);
		const start = Date.now();
		const matches = searchCanariesInBuffer(chunk, [canary]);
		const elapsed = Date.now() - start;
		expect(matches.length).toBe(1);
		expect(matches[0]?.offset).toBe(at);
		expect(elapsed).toBeLessThan(2000);
	});
});
