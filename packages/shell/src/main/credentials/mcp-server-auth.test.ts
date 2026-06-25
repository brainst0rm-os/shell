import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateSymmetricKey } from "./crypto";
import {
	deleteMcpServerAuth,
	mcpServerCredentialKey,
	readMcpServerAuth,
	writeMcpServerAuth,
} from "./mcp-server-auth";
import { CredentialStore } from "./store";

describe("mcp-server-auth (MCP-1 Tier-2 credential custody)", () => {
	let vaultDir: string;
	let store: CredentialStore;

	beforeEach(async () => {
		vaultDir = await mkdtemp(join(tmpdir(), "brainstorm-mcp-auth-"));
		store = new CredentialStore(vaultDir, generateSymmetricKey());
	});
	afterEach(async () => {
		await rm(vaultDir, { recursive: true, force: true });
	});

	it("namespaces the credential key per server under the shell MCP app", () => {
		expect(mcpServerCredentialKey("github")).toEqual({
			app: "io.brainstorm.mcp",
			key: "mcp-server-auth:github",
		});
	});

	it("round-trips write → read → delete (sealed at rest)", async () => {
		expect(await readMcpServerAuth(store, "github")).toBeNull();
		await writeMcpServerAuth(store, "github", "ghp_secrettoken");
		expect(await readMcpServerAuth(store, "github")).toBe("ghp_secrettoken");
		expect(await deleteMcpServerAuth(store, "github")).toBe(true);
		expect(await readMcpServerAuth(store, "github")).toBeNull();
		expect(await deleteMcpServerAuth(store, "github")).toBe(false);
	});

	it("keeps servers' secrets independent", async () => {
		await writeMcpServerAuth(store, "a", "token-a");
		await writeMcpServerAuth(store, "b", "token-b");
		expect(await readMcpServerAuth(store, "a")).toBe("token-a");
		expect(await readMcpServerAuth(store, "b")).toBe("token-b");
	});

	it("the secret is sealed on disk (not plaintext)", async () => {
		await writeMcpServerAuth(store, "github", "ghp_plainsecret");
		const onDisk = await import("node:fs/promises").then((fs) =>
			fs.readFile(join(vaultDir, "shell", "credentials.json"), "utf8"),
		);
		expect(onDisk).not.toContain("ghp_plainsecret");
	});
});
