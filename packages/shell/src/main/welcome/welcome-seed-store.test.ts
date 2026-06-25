import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	readWelcomeSeedVersion,
	welcomeSeedStampPath,
	writeWelcomeSeedVersion,
} from "./welcome-seed-store";

let vaultPath: string;

beforeEach(() => {
	vaultPath = mkdtempSync(join(tmpdir(), "bs-welcome-seed-"));
});
afterEach(() => {
	rmSync(vaultPath, { recursive: true, force: true });
});

describe("welcome-seed-store", () => {
	it("resolves under <vault>/shell/", () => {
		expect(welcomeSeedStampPath(vaultPath)).toBe(join(vaultPath, "shell", "welcome-seed.json"));
	});

	it("reads 0 when no stamp file exists (never seeded)", async () => {
		expect(await readWelcomeSeedVersion(vaultPath)).toBe(0);
	});

	it("round-trips a written version", async () => {
		await writeWelcomeSeedVersion(vaultPath, 3);
		expect(await readWelcomeSeedVersion(vaultPath)).toBe(3);
	});

	it("creates the shell/ directory on write", async () => {
		await writeWelcomeSeedVersion(vaultPath, 1);
		expect(await readWelcomeSeedVersion(vaultPath)).toBe(1);
	});

	it("reads 0 on a corrupt file (re-seed, safe direction)", async () => {
		const path = welcomeSeedStampPath(vaultPath);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, "{ not json", "utf8");
		expect(await readWelcomeSeedVersion(vaultPath)).toBe(0);
	});

	it("reads 0 when the shape is wrong (missing/!integer seedVersion)", async () => {
		const path = welcomeSeedStampPath(vaultPath);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify({ seedVersion: "two" }), "utf8");
		expect(await readWelcomeSeedVersion(vaultPath)).toBe(0);
		writeFileSync(path, JSON.stringify({ other: 1 }), "utf8");
		expect(await readWelcomeSeedVersion(vaultPath)).toBe(0);
	});
});
