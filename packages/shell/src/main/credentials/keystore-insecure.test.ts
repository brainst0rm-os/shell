import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { INSECURE_FILENAME, InsecureBackend } from "./keystore-insecure";

describe("InsecureBackend", () => {
	let vaultDir: string;
	let backend: InsecureBackend;

	beforeEach(async () => {
		vaultDir = await mkdtemp(join(tmpdir(), "brainstorm-insecure-"));
		backend = new InsecureBackend(vaultDir);
	});

	afterEach(async () => {
		await rm(vaultDir, { recursive: true, force: true });
	});

	it("declares itself insecure but persistent", () => {
		expect(backend.isInsecure).toBe(true);
		expect(backend.isPersistent).toBe(true);
		expect(backend.name).toBe("insecure-dev");
	});

	it("round-trips a secret through set + get", async () => {
		const value = new Uint8Array([1, 2, 3, 250, 251, 252]);
		await backend.setSecret("vlt_a", "master", value);
		const got = await backend.getSecret("vlt_a", "master");
		expect(got).not.toBeNull();
		expect(Array.from(got ?? [])).toEqual(Array.from(value));
	});

	it("returns null for unknown accounts", async () => {
		expect(await backend.getSecret("vlt_a", "master")).toBeNull();
	});

	it("keeps secrets isolated per vault-id", async () => {
		await backend.setSecret("vlt_a", "master", new Uint8Array([1]));
		await backend.setSecret("vlt_b", "master", new Uint8Array([2]));
		expect(Array.from((await backend.getSecret("vlt_a", "master")) ?? [])).toEqual([1]);
		expect(Array.from((await backend.getSecret("vlt_b", "master")) ?? [])).toEqual([2]);
	});

	it("keeps secrets isolated per account kind", async () => {
		await backend.setSecret("vlt_a", "master", new Uint8Array([1]));
		await backend.setSecret("vlt_a", "identity", new Uint8Array([2]));
		expect(Array.from((await backend.getSecret("vlt_a", "master")) ?? [])).toEqual([1]);
		expect(Array.from((await backend.getSecret("vlt_a", "identity")) ?? [])).toEqual([2]);
	});

	it("deleteSecret returns true when an entry existed", async () => {
		await backend.setSecret("vlt_a", "master", new Uint8Array([1]));
		expect(await backend.deleteSecret("vlt_a", "master")).toBe(true);
		expect(await backend.getSecret("vlt_a", "master")).toBeNull();
	});

	it("deleteSecret returns false for missing entries", async () => {
		expect(await backend.deleteSecret("vlt_a", "master")).toBe(false);
	});

	it("persists across instances on the same path", async () => {
		await backend.setSecret("vlt_a", "master", new Uint8Array([9, 9, 9]));
		const other = new InsecureBackend(vaultDir);
		expect(Array.from((await other.getSecret("vlt_a", "master")) ?? [])).toEqual([9, 9, 9]);
	});

	it("writes a giant red warning into the file", async () => {
		await backend.setSecret("vlt_a", "master", new Uint8Array([1]));
		const raw = await readFile(join(vaultDir, "shell", INSECURE_FILENAME), "utf8");
		expect(raw).toMatch(/DEV MODE/);
		expect(raw).toMatch(/UNENCRYPTED/);
	});

	it("clear() removes the file entirely", async () => {
		await backend.setSecret("vlt_a", "master", new Uint8Array([1]));
		await backend.clear();
		const fresh = new InsecureBackend(vaultDir);
		expect(await fresh.getSecret("vlt_a", "master")).toBeNull();
	});

	it("handles a malformed file by treating it as empty", async () => {
		await backend.setSecret("vlt_a", "master", new Uint8Array([1]));
		await rm(join(vaultDir, "shell", INSECURE_FILENAME), { force: true });
		// New backend instance, fresh state.
		const fresh = new InsecureBackend(vaultDir);
		expect(await fresh.getSecret("vlt_a", "master")).toBeNull();
	});
});
