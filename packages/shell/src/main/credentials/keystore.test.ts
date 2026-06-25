import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KEYSTORE_BACKEND_DISPLAY, isInsecureModeEnabled, pickKeystore } from "./keystore";
import { PASSPHRASE_WRAP_FILENAME } from "./keystore-insecure";

describe("keystore picker", () => {
	let vaultDir: string;
	const previousEnv = process.env.BRAINSTORM_DEV_INSECURE_CREDENTIALS;

	beforeEach(async () => {
		vaultDir = await mkdtemp(join(tmpdir(), "brainstorm-keystore-"));
		process.env.BRAINSTORM_DEV_INSECURE_CREDENTIALS = undefined;
	});

	afterEach(async () => {
		await rm(vaultDir, { recursive: true, force: true });
		if (previousEnv === undefined) process.env.BRAINSTORM_DEV_INSECURE_CREDENTIALS = undefined;
		else process.env.BRAINSTORM_DEV_INSECURE_CREDENTIALS = previousEnv;
	});

	it("returns InsecureBackend when forceInsecure is set", async () => {
		const backend = await pickKeystore({ vaultPath: vaultDir, forceInsecure: true });
		expect(backend.name).toBe("insecure-dev");
		expect(backend.isInsecure).toBe(true);
	});

	it("returns InsecureBackend when BRAINSTORM_DEV_INSECURE_CREDENTIALS=1", async () => {
		process.env.BRAINSTORM_DEV_INSECURE_CREDENTIALS = "1";
		const backend = await pickKeystore({ vaultPath: vaultDir });
		expect(backend.name).toBe("insecure-dev");
	});

	it("isInsecureModeEnabled reports the env var", () => {
		process.env.BRAINSTORM_DEV_INSECURE_CREDENTIALS = undefined;
		expect(isInsecureModeEnabled()).toBe(false);
		process.env.BRAINSTORM_DEV_INSECURE_CREDENTIALS = "1";
		expect(isInsecureModeEnabled()).toBe(true);
		process.env.BRAINSTORM_DEV_INSECURE_CREDENTIALS = "0";
		expect(isInsecureModeEnabled()).toBe(false);
	});

	it("returns the PassphraseBackend if a wrap file exists and a passphrase is provided", async () => {
		// Pre-create a passphrase wrap by calling the backend directly.
		const { PassphraseBackend } = await import("./keystore-passphrase");
		const first = await PassphraseBackend.openOrCreate(vaultDir, {
			passphrase: "p",
			kdf: { m: 8, t: 1, p: 1 },
		});
		await first.setSecret("vlt_a", "master", new Uint8Array([7]));

		const backend = await pickKeystore({
			vaultPath: vaultDir,
			skipKeyring: true,
			passphrase: { passphrase: "p" },
		});
		expect(backend.name).toBe("passphrase");
		const got = await backend.getSecret("vlt_a", "master");
		expect(Array.from(got ?? [])).toEqual([7]);
	});

	it("throws a clear error if a wrap file exists but no passphrase is provided", async () => {
		await mkdir(join(vaultDir, "shell"), { recursive: true });
		await writeFile(
			join(vaultDir, "shell", PASSPHRASE_WRAP_FILENAME),
			JSON.stringify({ v: 1, kdf: { algo: "argon2id", m: 8, t: 1, p: 1, saltB64: "" } }),
			"utf8",
		);
		await expect(pickKeystore({ vaultPath: vaultDir, skipKeyring: true })).rejects.toThrow(
			/passphrase/i,
		);
	});

	it("throws a clear error if no backend is available", async () => {
		await expect(pickKeystore({ vaultPath: vaultDir, skipKeyring: true })).rejects.toThrow(
			/no os keystore is available/i,
		);
	});

	it("exports human-readable backend names", () => {
		expect(KEYSTORE_BACKEND_DISPLAY["keychain-macos"]).toBe("macOS Keychain");
		expect(KEYSTORE_BACKEND_DISPLAY["credential-manager-windows"]).toBe("Windows Credential Manager");
		expect(KEYSTORE_BACKEND_DISPLAY["secret-service-linux"]).toBe("Linux Secret Service");
		expect(KEYSTORE_BACKEND_DISPLAY.passphrase).toBe("Passphrase");
		expect(KEYSTORE_BACKEND_DISPLAY["insecure-dev"]).toBe("Insecure (dev mode)");
	});
});
