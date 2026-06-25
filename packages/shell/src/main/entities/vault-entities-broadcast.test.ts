/**
 * `vault-entities-broadcast.ts` — cross-renderer stale-signal helper +
 * note-write envelope predicate. The broadcast helper mirrors the
 * `app:properties-changed` plumbing in `properties-handlers.test.ts`;
 * the predicate gates the fire-site so non-note writes don't trigger
 * graph re-renders. (Stage 9.6 B6.3.)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Envelope } from "../../ipc/envelope";
import type { AppWindow } from "../apps/launcher";
import {
	APP_VAULT_ENTITIES_CHANGED_CHANNEL,
	broadcastVaultEntitiesStaleSignal,
	isVaultEntityWriteEnvelope,
} from "./vault-entities-broadcast";

type FakeWindow = {
	appId: string;
	send: ReturnType<typeof vi.fn>;
	destroyed: boolean;
};

function fakeAppWindow(
	appId: string,
	opts: { destroyed?: boolean } = {},
): {
	win: AppWindow;
	rec: FakeWindow;
} {
	const rec: FakeWindow = {
		appId,
		send: vi.fn(),
		destroyed: opts.destroyed === true,
	};
	const win = {
		appId,
		windowId: "main",
		webContentsId: 0,
		webContents: { send: rec.send, isDestroyed: () => rec.destroyed },
	} as unknown as AppWindow;
	return { win, rec };
}

function envelope(over: Partial<Envelope>): Envelope {
	return {
		v: 1,
		msg: "m_test",
		app: "io.brainstorm.notes",
		service: "storage",
		method: "put",
		args: [{ key: "note:abc", value: { body: "x" } }],
		caps: ["storage.kv"],
		...over,
	};
}

describe("broadcastVaultEntitiesStaleSignal", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("sends `app:vault-entities-changed` to every live app window", () => {
		const a = fakeAppWindow("io.brainstorm.graph");
		const b = fakeAppWindow("io.brainstorm.database");
		broadcastVaultEntitiesStaleSignal([a.win, b.win]);
		expect(a.rec.send).toHaveBeenCalledWith(APP_VAULT_ENTITIES_CHANGED_CHANNEL);
		expect(b.rec.send).toHaveBeenCalledWith(APP_VAULT_ENTITIES_CHANGED_CHANNEL);
	});

	it("skips destroyed windows", () => {
		const live = fakeAppWindow("io.brainstorm.graph");
		const dead = fakeAppWindow("io.brainstorm.database", { destroyed: true });
		broadcastVaultEntitiesStaleSignal([dead.win, live.win]);
		expect(dead.rec.send).not.toHaveBeenCalled();
		expect(live.rec.send).toHaveBeenCalledWith(APP_VAULT_ENTITIES_CHANGED_CHANNEL);
	});

	it("survives an individual webContents.send throwing", () => {
		const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const failing = fakeAppWindow("io.brainstorm.graph");
		failing.rec.send.mockImplementation(() => {
			throw new Error("destroyed mid-send");
		});
		const live = fakeAppWindow("io.brainstorm.database");
		expect(() => broadcastVaultEntitiesStaleSignal([failing.win, live.win])).not.toThrow();
		expect(live.rec.send).toHaveBeenCalledWith(APP_VAULT_ENTITIES_CHANGED_CHANNEL);
		expect(consoleSpy).toHaveBeenCalled();
	});

	it("survives a window whose webContents was already torn down (undefined)", () => {
		// A tab closing concurrently with an entity write leaves an AppWindow in
		// the live list whose `webContents` Electron has already nulled. The guard
		// must not deref it. Repro for the sweep's "saveTask failed: Cannot read
		// properties of undefined (reading 'isDestroyed')".
		const torn = {
			appId: "io.brainstorm.tasks",
			windowId: "main",
			webContentsId: 0,
		} as unknown as AppWindow;
		const live = fakeAppWindow("io.brainstorm.database");
		expect(() => broadcastVaultEntitiesStaleSignal([torn, live.win])).not.toThrow();
		expect(live.rec.send).toHaveBeenCalledWith(APP_VAULT_ENTITIES_CHANGED_CHANNEL);
	});

	it("is a no-op on an empty array", () => {
		expect(() => broadcastVaultEntitiesStaleSignal([])).not.toThrow();
	});
});

describe("isVaultEntityWriteEnvelope", () => {
	it("matches a Notes storage.put on a note:* key", () => {
		expect(isVaultEntityWriteEnvelope(envelope({}))).toBe(true);
	});

	it("matches a Notes storage.delete on a note:* key", () => {
		expect(
			isVaultEntityWriteEnvelope(envelope({ method: "delete", args: [{ key: "note:abc" }] })),
		).toBe(true);
	});

	it("rejects writes to non-note keys (Notes' own settings)", () => {
		expect(
			isVaultEntityWriteEnvelope(envelope({ args: [{ key: "settings:layout", value: "stacked" }] })),
		).toBe(false);
	});

	it("rejects writes from apps with no recognised entity keys", () => {
		expect(isVaultEntityWriteEnvelope(envelope({ app: "io.brainstorm.database" }))).toBe(false);
	});

	it("matches a Tasks storage.put on a task:* key", () => {
		expect(
			isVaultEntityWriteEnvelope(
				envelope({
					app: "io.brainstorm.tasks",
					args: [{ key: "task:abc", value: {} }],
				}),
			),
		).toBe(true);
	});

	it("matches a Tasks storage.put on a project:* key", () => {
		expect(
			isVaultEntityWriteEnvelope(
				envelope({
					app: "io.brainstorm.tasks",
					args: [{ key: "project:p1", value: {} }],
				}),
			),
		).toBe(true);
	});

	it("matches a Tasks storage.delete on a task:* key", () => {
		expect(
			isVaultEntityWriteEnvelope(
				envelope({
					app: "io.brainstorm.tasks",
					method: "delete",
					args: [{ key: "task:abc" }],
				}),
			),
		).toBe(true);
	});

	it("rejects Tasks writes to keys outside task:/project:", () => {
		expect(
			isVaultEntityWriteEnvelope(
				envelope({
					app: "io.brainstorm.tasks",
					args: [{ key: "settings:filter", value: {} }],
				}),
			),
		).toBe(false);
	});

	it("rejects note:* keys written from the wrong app", () => {
		expect(
			isVaultEntityWriteEnvelope(
				envelope({ app: "io.brainstorm.tasks", args: [{ key: "note:abc" }] }),
			),
		).toBe(false);
	});

	it("rejects non-storage services", () => {
		expect(isVaultEntityWriteEnvelope(envelope({ service: "intents", method: "dispatch" }))).toBe(
			false,
		);
	});

	it("rejects storage methods other than put / delete (no signal for reads)", () => {
		expect(isVaultEntityWriteEnvelope(envelope({ method: "get" }))).toBe(false);
		expect(isVaultEntityWriteEnvelope(envelope({ method: "list", args: [{ key: "note:" }] }))).toBe(
			false,
		);
	});

	it("rejects malformed args (missing key)", () => {
		expect(isVaultEntityWriteEnvelope(envelope({ args: [{ value: "x" }] }))).toBe(false);
		expect(isVaultEntityWriteEnvelope(envelope({ args: [] }))).toBe(false);
	});

	it("rejects non-string keys", () => {
		expect(isVaultEntityWriteEnvelope(envelope({ args: [{ key: 42 }] }))).toBe(false);
	});

	it("matches a self-hosting storage.put on an iteration:* key", () => {
		expect(
			isVaultEntityWriteEnvelope(
				envelope({
					app: "io.brainstorm.self-hosting",
					args: [{ key: "iteration:iter-7-1", value: {} }],
				}),
			),
		).toBe(true);
	});

	it("matches a self-hosting storage.put on a stage:* key", () => {
		expect(
			isVaultEntityWriteEnvelope(
				envelope({
					app: "io.brainstorm.self-hosting",
					args: [{ key: "stage:stage-7a", value: {} }],
				}),
			),
		).toBe(true);
	});

	it("matches a self-hosting storage.put on an open-question:* key", () => {
		expect(
			isVaultEntityWriteEnvelope(
				envelope({
					app: "io.brainstorm.self-hosting",
					args: [{ key: "open-question:oq-12", value: {} }],
				}),
			),
		).toBe(true);
	});

	it("matches a self-hosting storage.put on a design-doc:* key", () => {
		expect(
			isVaultEntityWriteEnvelope(
				envelope({
					app: "io.brainstorm.self-hosting",
					args: [{ key: "design-doc:doc-12", value: {} }],
				}),
			),
		).toBe(true);
	});

	it("matches a self-hosting storage.delete on a recognised key", () => {
		expect(
			isVaultEntityWriteEnvelope(
				envelope({
					app: "io.brainstorm.self-hosting",
					method: "delete",
					args: [{ key: "iteration:iter-x" }],
				}),
			),
		).toBe(true);
	});

	it("rejects self-hosting writes to keys outside the recognised prefixes", () => {
		expect(
			isVaultEntityWriteEnvelope(
				envelope({
					app: "io.brainstorm.self-hosting",
					args: [{ key: "settings:layout", value: {} }],
				}),
			),
		).toBe(false);
	});
});
