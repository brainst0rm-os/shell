import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateSymmetricKey } from "./crypto";
import { CREDENTIALS_FILENAME, CredentialStore, MAX_VALUE_BYTES } from "./store";

describe("CredentialStore", () => {
	let vaultDir: string;
	let masterKey: Uint8Array;
	let store: CredentialStore;

	beforeEach(async () => {
		vaultDir = await mkdtemp(join(tmpdir(), "brainstorm-credstore-"));
		masterKey = generateSymmetricKey();
		store = new CredentialStore(vaultDir, masterKey);
	});

	afterEach(async () => {
		await rm(vaultDir, { recursive: true, force: true });
	});

	it("round-trips a value through set + get", async () => {
		const value = new TextEncoder().encode("sk-anthropic-abc123");
		await store.set({ app: "shell", key: "ai:provider:anthropic" }, value);
		const got = await store.get({ app: "shell", key: "ai:provider:anthropic" });
		expect(new TextDecoder().decode(got ?? new Uint8Array())).toBe("sk-anthropic-abc123");
	});

	it("returns null for unknown keys", async () => {
		expect(await store.get({ app: "shell", key: "nope" })).toBeNull();
	});

	it("delete returns true only when an entry existed", async () => {
		expect(await store.delete({ app: "shell", key: "k" })).toBe(false);
		await store.set({ app: "shell", key: "k" }, new Uint8Array([1]));
		expect(await store.delete({ app: "shell", key: "k" })).toBe(true);
		expect(await store.get({ app: "shell", key: "k" })).toBeNull();
	});

	it("list returns metadata for an app's keyspace, sorted by key", async () => {
		await store.set({ app: "io.example.notes", key: "b" }, new Uint8Array([1]));
		await store.set({ app: "io.example.notes", key: "a" }, new Uint8Array([2]));
		await store.set({ app: "shell", key: "other" }, new Uint8Array([3]));

		const notes = await store.list("io.example.notes");
		expect(notes.map((m) => m.key)).toEqual(["a", "b"]);
		const shell = await store.list("shell");
		expect(shell.map((m) => m.key)).toEqual(["other"]);
	});

	it("persists across instances on the same master key", async () => {
		await store.set({ app: "shell", key: "k" }, new Uint8Array([9, 9, 9]));
		const other = new CredentialStore(vaultDir, masterKey);
		const got = await other.get({ app: "shell", key: "k" });
		expect(Array.from(got ?? [])).toEqual([9, 9, 9]);
	});

	it("a different master key cannot decrypt existing values", async () => {
		await store.set({ app: "shell", key: "k" }, new Uint8Array([1]));
		const stranger = new CredentialStore(vaultDir, generateSymmetricKey());
		await expect(stranger.get({ app: "shell", key: "k" })).rejects.toThrow(/decrypt/i);
	});

	it("ciphertext does not contain the plaintext substring", async () => {
		const recognizable = new TextEncoder().encode("RECOGNIZABLE_PLAINTEXT_TOKEN");
		await store.set({ app: "shell", key: "k" }, recognizable);
		const raw = await readFile(join(vaultDir, "shell", CREDENTIALS_FILENAME), "utf8");
		expect(raw).not.toContain("RECOGNIZABLE_PLAINTEXT_TOKEN");
	});

	it("AAD binds value to (app, key) — moving raw entry between keys fails to decrypt", async () => {
		await store.set({ app: "shell", key: "first" }, new TextEncoder().encode("secret"));
		const raw = JSON.parse(await readFile(join(vaultDir, "shell", CREDENTIALS_FILENAME), "utf8"));
		const sealed = raw.entries["shell::first"].sealed;
		raw.entries["shell::second"] = { ...raw.entries["shell::first"], key: "second", sealed };
		const { writeFile } = await import("node:fs/promises");
		await writeFile(join(vaultDir, "shell", CREDENTIALS_FILENAME), JSON.stringify(raw), "utf8");
		const fresh = new CredentialStore(vaultDir, masterKey);
		await expect(fresh.get({ app: "shell", key: "second" })).rejects.toThrow();
		// First key is still readable.
		expect(
			new TextDecoder().decode((await fresh.get({ app: "shell", key: "first" })) ?? new Uint8Array()),
		).toBe("secret");
	});

	it("updating a value preserves createdAt and refreshes updatedAt", async () => {
		await store.set({ app: "shell", key: "k" }, new Uint8Array([1]));
		const first = (await store.list("shell"))[0];
		expect(first).toBeDefined();
		await new Promise((r) => setTimeout(r, 2));
		await store.set({ app: "shell", key: "k" }, new Uint8Array([2]));
		const second = (await store.list("shell"))[0];
		expect(second).toBeDefined();
		if (!first || !second) throw new Error("expected metadata entries");
		expect(second.createdAt).toBe(first.createdAt);
		expect(second.updatedAt).toBeGreaterThanOrEqual(first.updatedAt);
	});

	it("rejects oversized values", async () => {
		const big = new Uint8Array(MAX_VALUE_BYTES + 1);
		await expect(store.set({ app: "shell", key: "k" }, big)).rejects.toThrow(/too large/);
	});

	it("rejects invalid app id and key", async () => {
		await expect(store.set({ app: "bad/app", key: "k" }, new Uint8Array([1]))).rejects.toThrow(
			/app id/,
		);
		await expect(
			store.set({ app: "shell", key: "bad whitespace" }, new Uint8Array([1])),
		).rejects.toThrow(/key/);
	});

	it("rejects wrong-sized master key in the constructor", () => {
		expect(() => new CredentialStore(vaultDir, new Uint8Array(16))).toThrow(/32 bytes/);
	});

	it("clear() removes the file", async () => {
		await store.set({ app: "shell", key: "k" }, new Uint8Array([1]));
		await store.clear();
		const fresh = new CredentialStore(vaultDir, masterKey);
		expect(await fresh.get({ app: "shell", key: "k" })).toBeNull();
	});

	it("a fresh nonce is used per write (same plaintext → different ciphertext on disk)", async () => {
		const plaintext = new Uint8Array([1, 2, 3, 4]);
		await store.set({ app: "shell", key: "k" }, plaintext);
		const first = JSON.parse(await readFile(join(vaultDir, "shell", CREDENTIALS_FILENAME), "utf8"));
		const ct1 = first.entries["shell::k"].sealed.ciphertextB64;
		await store.set({ app: "shell", key: "k" }, plaintext);
		const second = JSON.parse(await readFile(join(vaultDir, "shell", CREDENTIALS_FILENAME), "utf8"));
		const ct2 = second.entries["shell::k"].sealed.ciphertextB64;
		expect(ct1).not.toBe(ct2);
	});

	it("apps cannot list each other's keys", async () => {
		await store.set({ app: "io.example.notes", key: "secret" }, new Uint8Array([1]));
		expect(await store.list("io.example.other")).toEqual([]);
	});
});
