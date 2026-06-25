import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PASSPHRASE_WRAP_FILENAME } from "./keystore-insecure";
import { PassphraseBackend } from "./keystore-passphrase";

// Tiny KDF profile so tests don't burn 64 MiB × 3 iterations on every case.
// Argon2id at m=8, t=1, p=1 still exercises the same code paths but completes
// in <10 ms instead of >1 s.
const TEST_KDF = { m: 8, t: 1, p: 1 };

describe("PassphraseBackend", () => {
	let vaultDir: string;

	beforeEach(async () => {
		vaultDir = await mkdtemp(join(tmpdir(), "brainstorm-passphrase-"));
	});

	afterEach(async () => {
		await rm(vaultDir, { recursive: true, force: true });
	});

	it("declares itself secure + persistent", async () => {
		const backend = await PassphraseBackend.openOrCreate(vaultDir, {
			passphrase: "hunter2",
			kdf: TEST_KDF,
		});
		expect(backend.isInsecure).toBe(false);
		expect(backend.isPersistent).toBe(true);
		expect(backend.name).toBe("passphrase");
	});

	it("creates a wrap file with KDF parameters + verifier", async () => {
		await PassphraseBackend.openOrCreate(vaultDir, { passphrase: "p", kdf: TEST_KDF });
		const raw = await readFile(join(vaultDir, "shell", PASSPHRASE_WRAP_FILENAME), "utf8");
		const parsed = JSON.parse(raw);
		expect(parsed.kdf.algo).toBe("argon2id");
		expect(parsed.kdf.m).toBe(TEST_KDF.m);
		expect(parsed.kdf.t).toBe(TEST_KDF.t);
		expect(parsed.kdf.p).toBe(TEST_KDF.p);
		expect(parsed.verifierB64).toMatch(/[A-Za-z0-9+/=]+/);
		expect(parsed.verifierNonceB64).toMatch(/[A-Za-z0-9+/=]+/);
	});

	it("round-trips a secret through encrypted storage", async () => {
		const backend = await PassphraseBackend.openOrCreate(vaultDir, {
			passphrase: "p",
			kdf: TEST_KDF,
		});
		const secret = new Uint8Array(32);
		for (let i = 0; i < 32; i++) secret[i] = i;
		await backend.setSecret("vlt_a", "master", secret);
		const got = await backend.getSecret("vlt_a", "master");
		expect(Array.from(got ?? [])).toEqual(Array.from(secret));
	});

	it("reopening with the same passphrase recovers stored secrets", async () => {
		const first = await PassphraseBackend.openOrCreate(vaultDir, {
			passphrase: "correct horse battery staple",
			kdf: TEST_KDF,
		});
		await first.setSecret("vlt_a", "identity", new Uint8Array([7, 8, 9]));
		first.dispose();

		const second = await PassphraseBackend.openOrCreate(vaultDir, {
			passphrase: "correct horse battery staple",
		});
		const got = await second.getSecret("vlt_a", "identity");
		expect(Array.from(got ?? [])).toEqual([7, 8, 9]);
	});

	it("rejects a wrong passphrase with a clear error", async () => {
		await PassphraseBackend.openOrCreate(vaultDir, { passphrase: "right", kdf: TEST_KDF });
		await expect(PassphraseBackend.openOrCreate(vaultDir, { passphrase: "wrong" })).rejects.toThrow(
			/Incorrect passphrase/,
		);
	});

	it("ciphertexts in the wrap file never reveal the plaintext", async () => {
		const backend = await PassphraseBackend.openOrCreate(vaultDir, {
			passphrase: "p",
			kdf: TEST_KDF,
		});
		const recognizable = new TextEncoder().encode("THIS_SHOULD_NEVER_APPEAR_IN_CIPHERTEXT");
		await backend.setSecret("vlt_a", "master", recognizable);
		const raw = await readFile(join(vaultDir, "shell", PASSPHRASE_WRAP_FILENAME), "utf8");
		expect(raw).not.toContain("THIS_SHOULD_NEVER_APPEAR_IN_CIPHERTEXT");
	});

	it("uses a fresh nonce per write (same plaintext → different ciphertext)", async () => {
		const backend = await PassphraseBackend.openOrCreate(vaultDir, {
			passphrase: "p",
			kdf: TEST_KDF,
		});
		const value = new Uint8Array([42, 42, 42, 42]);
		await backend.setSecret("vlt_a", "master", value);
		const raw1 = await readFile(join(vaultDir, "shell", PASSPHRASE_WRAP_FILENAME), "utf8");
		const ct1 = JSON.parse(raw1).secrets["vlt_a.master"];
		await backend.setSecret("vlt_a", "master", value);
		const raw2 = await readFile(join(vaultDir, "shell", PASSPHRASE_WRAP_FILENAME), "utf8");
		const ct2 = JSON.parse(raw2).secrets["vlt_a.master"];
		expect(ct1.ciphertextB64).not.toEqual(ct2.ciphertextB64);
		expect(ct1.nonceB64).not.toEqual(ct2.nonceB64);
	});

	it("getSecret returns null for unknown accounts", async () => {
		const backend = await PassphraseBackend.openOrCreate(vaultDir, {
			passphrase: "p",
			kdf: TEST_KDF,
		});
		expect(await backend.getSecret("vlt_a", "master")).toBeNull();
	});

	it("deleteSecret returns true only when an entry existed", async () => {
		const backend = await PassphraseBackend.openOrCreate(vaultDir, {
			passphrase: "p",
			kdf: TEST_KDF,
		});
		expect(await backend.deleteSecret("vlt_a", "master")).toBe(false);
		await backend.setSecret("vlt_a", "master", new Uint8Array([1]));
		expect(await backend.deleteSecret("vlt_a", "master")).toBe(true);
		expect(await backend.getSecret("vlt_a", "master")).toBeNull();
	});

	it("dispose() wipes the in-memory wrap key", async () => {
		const backend = await PassphraseBackend.openOrCreate(vaultDir, {
			passphrase: "p",
			kdf: TEST_KDF,
		});
		await backend.setSecret("vlt_a", "master", new Uint8Array([1]));
		backend.dispose();
		await expect(backend.getSecret("vlt_a", "master")).rejects.toThrow();
	});

	it("refuses to open a malformed wrap file", async () => {
		const filePath = join(vaultDir, "shell", PASSPHRASE_WRAP_FILENAME);
		const { mkdir, writeFile } = await import("node:fs/promises");
		await mkdir(join(vaultDir, "shell"), { recursive: true });
		await writeFile(filePath, "{}", "utf8");
		await expect(PassphraseBackend.openOrCreate(vaultDir, { passphrase: "p" })).rejects.toThrow(
			/malformed/,
		);
	});
});
