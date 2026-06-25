/**
 * Welcome-2 (9.3.5.V 7d) — `welcome:list-templates` handler + the pure
 * `listTemplateSummaries` projection that backs the first-launch gallery. The
 * import path is covered separately (`run-template-import.test.ts`); here we
 * assert the gallery list matches the real registry and never leaks the
 * main-process `build` closure across IPC.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock("electron", () => ({
	ipcMain: {
		handle: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
			handlers.set(channel, listener);
		}),
		removeHandler: vi.fn((channel: string) => {
			handlers.delete(channel);
		}),
	},
}));

vi.mock("../vault/session", () => ({ getActiveVaultSession: vi.fn(() => null) }));
vi.mock("../welcome/run-template-import", () => ({ runTemplateImportById: vi.fn() }));

const { listTemplateSummaries, registerWelcomeHandlers, WELCOME_LIST_TEMPLATES_CHANNEL } =
	await import("./welcome-handlers");
const { TEMPLATE_IDS } = await import("../welcome/template-registry");

beforeEach(() => {
	handlers.clear();
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("listTemplateSummaries", () => {
	it("returns one summary per registry template, in registry order", () => {
		const summaries = listTemplateSummaries();
		expect(summaries.map((s) => s.id)).toEqual([...TEMPLATE_IDS]);
	});

	it("carries non-empty display metadata for every template", () => {
		for (const summary of listTemplateSummaries()) {
			expect(summary.name.trim()).not.toBe("");
			expect(summary.description.trim()).not.toBe("");
		}
	});

	it("never leaks the main-process build closure across the IPC boundary", () => {
		for (const summary of listTemplateSummaries()) {
			expect(Object.keys(summary).sort()).toEqual(["description", "id", "name"]);
			expect("build" in summary).toBe(false);
		}
	});
});

describe("welcome:list-templates handler", () => {
	it("registers the list channel and returns the summaries", () => {
		registerWelcomeHandlers({
			makeApplyDocUpdate: vi.fn(() => vi.fn()),
			broadcastVaultEntitiesStale: vi.fn(),
		});
		const listener = handlers.get(WELCOME_LIST_TEMPLATES_CHANNEL);
		expect(listener).toBeTypeOf("function");
		expect(listener?.({})).toEqual(listTemplateSummaries());
	});
});
