import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ANTHROPIC_PROVIDER_ID, OLLAMA_PROVIDER_ID } from "@brainstorm/sdk-types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	MAX_APP_TOKEN_BUDGET,
	aiSettingsPath,
	defaultAiSettings,
	readAiSettings,
	setAppBudget,
	setDefaultProvider,
	validateAiSettings,
	writeAiSettings,
} from "./ai-settings-store";

describe("validateAiSettings", () => {
	it("keeps a routable default provider and a valid budget", () => {
		const out = validateAiSettings({
			defaultProvider: ANTHROPIC_PROVIDER_ID,
			appBudgets: { "io.brainstorm.agent": { maxTokens: 5000 } },
		});
		expect(out).toEqual({
			defaultProvider: ANTHROPIC_PROVIDER_ID,
			appBudgets: { "io.brainstorm.agent": { maxTokens: 5000 } },
		});
	});

	it("drops an unroutable provider, non-object input, and bad budgets", () => {
		expect(validateAiSettings({ defaultProvider: "evil-corp" }).defaultProvider).toBeNull();
		expect(validateAiSettings(null)).toEqual(defaultAiSettings());
		expect(validateAiSettings({ appBudgets: { app: { maxTokens: 0 } } }).appBudgets).toEqual({});
		expect(validateAiSettings({ appBudgets: { app: { maxTokens: -1 } } }).appBudgets).toEqual({});
		expect(validateAiSettings({ appBudgets: { "": { maxTokens: 5 } } }).appBudgets).toEqual({});
	});

	it("floors fractional budgets and clamps to the hard max", () => {
		const out = validateAiSettings({
			appBudgets: { a: { maxTokens: 12.9 }, b: { maxTokens: MAX_APP_TOKEN_BUDGET * 10 } },
		});
		expect(out.appBudgets.a).toEqual({ maxTokens: 12 });
		expect(out.appBudgets.b).toEqual({ maxTokens: MAX_APP_TOKEN_BUDGET });
	});
});

describe("readAiSettings / writeAiSettings + mutators", () => {
	let dir: string;
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "brainstorm-ai-settings-"));
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("default-on-first-read writes the default", async () => {
		expect(await readAiSettings(dir)).toEqual(defaultAiSettings());
		const raw = JSON.parse(await readFile(aiSettingsPath(dir), "utf8"));
		expect(raw).toEqual(defaultAiSettings());
	});

	it("setDefaultProvider round-trips and null clears", async () => {
		expect((await setDefaultProvider(dir, ANTHROPIC_PROVIDER_ID)).defaultProvider).toBe(
			ANTHROPIC_PROVIDER_ID,
		);
		expect((await readAiSettings(dir)).defaultProvider).toBe(ANTHROPIC_PROVIDER_ID);
		expect((await setDefaultProvider(dir, null)).defaultProvider).toBeNull();
		// An unroutable id is treated as a clear, never persisted.
		expect((await setDefaultProvider(dir, "nope")).defaultProvider).toBeNull();
		// A routable id with no key configured is still allowed (routing intent).
		expect((await setDefaultProvider(dir, OLLAMA_PROVIDER_ID)).defaultProvider).toBe(
			OLLAMA_PROVIDER_ID,
		);
	});

	it("setAppBudget sets, updates, and clears (<=0)", async () => {
		await setAppBudget(dir, "io.brainstorm.agent", 1000);
		expect((await readAiSettings(dir)).appBudgets["io.brainstorm.agent"]).toEqual({
			maxTokens: 1000,
		});
		await setAppBudget(dir, "io.brainstorm.agent", 2000);
		expect((await readAiSettings(dir)).appBudgets["io.brainstorm.agent"]).toEqual({
			maxTokens: 2000,
		});
		await setAppBudget(dir, "io.brainstorm.agent", 0);
		expect((await readAiSettings(dir)).appBudgets["io.brainstorm.agent"]).toBeUndefined();
		// An empty app id is a no-op.
		const before = await readAiSettings(dir);
		expect(await setAppBudget(dir, "", 50)).toEqual(before);
	});
});
