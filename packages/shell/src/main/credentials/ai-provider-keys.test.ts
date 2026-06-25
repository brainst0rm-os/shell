import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	aiProviderCredentialKey,
	deleteAiProviderKey,
	readAiProviderKey,
	writeAiProviderKey,
} from "./ai-provider-keys";
import { generateSymmetricKey } from "./crypto";
import { CredentialStore } from "./store";

describe("ai-provider-keys (11.6)", () => {
	let vaultDir: string;
	let store: CredentialStore;

	beforeEach(async () => {
		vaultDir = await mkdtemp(join(tmpdir(), "brainstorm-ai-keys-"));
		store = new CredentialStore(vaultDir, generateSymmetricKey());
	});

	afterEach(async () => {
		await rm(vaultDir, { recursive: true, force: true });
	});

	it("namespaces the credential key per provider under the shell AI app", () => {
		const key = aiProviderCredentialKey("anthropic");
		expect(key).toEqual({ app: "io.brainstorm.ai", key: "provider-key:anthropic" });
		expect(aiProviderCredentialKey("openai").key).toBe("provider-key:openai");
	});

	it("round-trips write → read", async () => {
		expect(await readAiProviderKey(store, "anthropic")).toBeNull();
		await writeAiProviderKey(store, "anthropic", "sk-ant-abc123");
		expect(await readAiProviderKey(store, "anthropic")).toBe("sk-ant-abc123");
	});

	it("keeps providers independent", async () => {
		await writeAiProviderKey(store, "anthropic", "sk-ant-1");
		await writeAiProviderKey(store, "openai", "sk-oai-2");
		expect(await readAiProviderKey(store, "anthropic")).toBe("sk-ant-1");
		expect(await readAiProviderKey(store, "openai")).toBe("sk-oai-2");
	});

	it("treats a blank stored value as absent", async () => {
		await writeAiProviderKey(store, "anthropic", "   ");
		expect(await readAiProviderKey(store, "anthropic")).toBeNull();
	});

	it("delete removes the key", async () => {
		await writeAiProviderKey(store, "anthropic", "sk-ant-abc123");
		expect(await deleteAiProviderKey(store, "anthropic")).toBe(true);
		expect(await readAiProviderKey(store, "anthropic")).toBeNull();
		expect(await deleteAiProviderKey(store, "anthropic")).toBe(false);
	});
});
