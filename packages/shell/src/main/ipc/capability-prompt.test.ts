import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VaultSession, closeActiveVaultSession, setActiveVaultSession } from "../vault/session";
import {
	CAPABILITY_PROMPT_CHANNEL,
	CapabilityPromptHost,
	type CapabilityPromptRequest,
	resetCapabilityPromptHost,
} from "./capability-prompt";

/** Fake `WebContents.send` — captures what the host posts. */
function fakeDashboard() {
	const posts: Array<{ channel: string; payload: CapabilityPromptRequest }> = [];
	const dashboard = {
		send: (channel: string, payload: CapabilityPromptRequest) => {
			posts.push({ channel, payload });
		},
	};
	return { dashboard, posts };
}

async function setup() {
	const vaultDir = await mkdtemp(join(tmpdir(), "brainstorm-prompt-"));
	const session = await VaultSession.create({
		vaultId: "vlt_prompt",
		vaultPath: vaultDir,
		forceInsecure: true,
	});
	setActiveVaultSession(session);
	// Warm the ledger so subsequent has() / grant() calls hit the same handle.
	await session.capabilityLedger();
	return { vaultDir, session };
}

describe("CapabilityPromptHost", () => {
	let env: Awaited<ReturnType<typeof setup>>;

	beforeEach(async () => {
		resetCapabilityPromptHost();
		env = await setup();
	});

	afterEach(async () => {
		closeActiveVaultSession();
		await rm(env.vaultDir, { recursive: true, force: true });
	});

	it("auto-approves a cap that's already in default-minimum without prompting", async () => {
		const host = new CapabilityPromptHost();
		const { dashboard, posts } = fakeDashboard();
		host.setDashboard(dashboard);
		const granted = await host.request("io.example.app", "storage.kv", "needs storage");
		expect(granted).toBe(true);
		expect(posts).toHaveLength(0);
	});

	it("posts a prompt to the dashboard and resolves true when accepted", async () => {
		const host = new CapabilityPromptHost();
		const { dashboard, posts } = fakeDashboard();
		host.setDashboard(dashboard);

		const promise = host.request(
			"io.example.app",
			"entities.read:io.example/Note/v1",
			"to render notes",
		);

		await new Promise((r) => setTimeout(r, 10));
		expect(posts).toHaveLength(1);
		expect(posts[0]?.channel).toBe(CAPABILITY_PROMPT_CHANNEL);
		const payload = posts[0]?.payload;
		expect(payload?.capability).toBe("entities.read:io.example/Note/v1");
		expect(payload?.reason).toBe("to render notes");

		if (!payload) throw new Error("expected payload");
		host.handleReply({ requestId: payload.requestId, accept: true });
		expect(await promise).toBe(true);
	});

	it("resolves false when the user denies", async () => {
		const host = new CapabilityPromptHost();
		const { dashboard, posts } = fakeDashboard();
		host.setDashboard(dashboard);

		const promise = host.request("io.example.app", "files.pick", "to pick a file");
		await new Promise((r) => setTimeout(r, 10));
		const payload = posts[0]?.payload;
		if (!payload) throw new Error("expected payload");
		host.handleReply({ requestId: payload.requestId, accept: false });
		expect(await promise).toBe(false);
	});

	it("resolves false when no dashboard is attached", async () => {
		const host = new CapabilityPromptHost();
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const granted = await host.request("io.example.app", "identity.sign", "to sign");
		expect(granted).toBe(false);
		warn.mockRestore();
	});

	it("resolves false when no vault is active", async () => {
		closeActiveVaultSession();
		const host = new CapabilityPromptHost();
		const { dashboard } = fakeDashboard();
		host.setDashboard(dashboard);
		expect(await host.request("io.example.app", "identity.sign", "to sign")).toBe(false);
	});

	it("granted caps after a prompt persist to the ledger as runtime grants", async () => {
		const host = new CapabilityPromptHost();
		const { dashboard, posts } = fakeDashboard();
		host.setDashboard(dashboard);

		const promise = host.request("io.example.app", "identity.sign", "to sign updates");
		await new Promise((r) => setTimeout(r, 10));
		const payload = posts[0]?.payload;
		if (!payload) throw new Error("expected payload");
		host.handleReply({ requestId: payload.requestId, accept: true });
		await promise;

		const session = env.session;
		const ledger = await session.capabilityLedger();
		expect(ledger.has("io.example.app", "identity.sign")).toBe(true);
		const history = ledger.historyFor("io.example.app", "identity.sign");
		expect(history[0]?.grantedVia).toBe("runtime");
	});

	it("duplicate replies are silently dropped (idempotent)", async () => {
		const host = new CapabilityPromptHost();
		const { dashboard, posts } = fakeDashboard();
		host.setDashboard(dashboard);
		const promise = host.request("io.example.app", "ai.use", "to summarize");
		await new Promise((r) => setTimeout(r, 10));
		const payload = posts[0]?.payload;
		if (!payload) throw new Error("expected payload");
		host.handleReply({ requestId: payload.requestId, accept: true });
		// Second reply: no listener, no throw.
		expect(() => host.handleReply({ requestId: payload.requestId, accept: false })).not.toThrow();
		expect(await promise).toBe(true);
	});

	it("resolves all pending requests with false when the dashboard goes away", async () => {
		const host = new CapabilityPromptHost();
		const { dashboard, posts } = fakeDashboard();
		host.setDashboard(dashboard);
		const p1 = host.request("io.example.app", "identity.sign", "r1");
		const p2 = host.request("io.example.app", "ai.use", "r2");
		await new Promise((r) => setTimeout(r, 10));
		expect(posts).toHaveLength(2);
		host.setDashboard(null);
		expect(await p1).toBe(false);
		expect(await p2).toBe(false);
	});

	it("getCapabilityPromptHost returns a stable singleton", async () => {
		const { getCapabilityPromptHost } = await import("./capability-prompt");
		const a = getCapabilityPromptHost();
		const b = getCapabilityPromptHost();
		expect(a).toBe(b);
	});
});
