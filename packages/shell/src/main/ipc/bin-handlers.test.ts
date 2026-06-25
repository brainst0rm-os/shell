/**
 * bin-handlers — the privileged ipcMain wiring for the Bin surface.
 * Electron is mocked (it doesn't run in Vitest); the handlers are driven
 * through a real `EntitiesRepository`. Asserts the channel round-trip,
 * the preload `BinItem` payload contract, and that `afterMutation` (the
 * vault-entities / search / dashboard fan-out) fires only on a
 * successful mutation.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown;
const handlers = new Map<string, IpcHandler>();

vi.mock("electron", () => ({
	ipcMain: {
		handle: (channel: string, fn: IpcHandler) => {
			handlers.set(channel, fn);
		},
	},
}));

import { DataStores } from "../storage/data-stores";
import { EntitiesRepository } from "../storage/entities-repo";
import { SettingsRepository } from "../storage/settings-repo";
import { registerBinHandlers } from "./bin-handlers";

const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)?.({}, ...args);

let vaultDir: string;
let stores: DataStores;
let repo: EntitiesRepository;
let afterMutation: ReturnType<typeof vi.fn<() => void>>;

beforeEach(async () => {
	handlers.clear();
	vaultDir = await mkdtemp(join(tmpdir(), "bs-bin-ipc-"));
	stores = new DataStores(vaultDir);
	repo = new EntitiesRepository(await stores.open("entities"));
	afterMutation = vi.fn<() => void>();
	registerBinHandlers({ getRepo: async () => repo, deleteAsset: async () => {}, afterMutation });
});

afterEach(async () => {
	stores.close();
	await rm(vaultDir, { recursive: true, force: true });
});

const seedDeleted = (id: string, at: number) => {
	repo.create({
		id,
		type: "io.x/Note/v1",
		properties: { title: id },
		createdBy: "io.x",
		now: 1,
		dekId: null,
	});
	repo.softDelete(id, at);
};

describe("bin-handlers", () => {
	it("registers exactly the six bin channels", () => {
		expect([...handlers.keys()].sort()).toEqual([
			"bin:empty",
			"bin:get-retention",
			"bin:list",
			"bin:purge",
			"bin:restore",
			"bin:set-retention",
		]);
	});

	it("bin:list returns the BinItem payload contract, most-recent-first", async () => {
		seedDeleted("a", 2000);
		seedDeleted("b", 3000);
		const items = (await invoke("bin:list")) as Array<Record<string, unknown>>;
		expect(items.map((i) => i.id)).toEqual(["b", "a"]);
		expect(Object.keys(items[0] ?? {}).sort()).toEqual(["deletedAt", "icon", "id", "title", "type"]);
		expect(afterMutation).not.toHaveBeenCalled(); // read → no fan-out
	});

	it("bin:restore restores and fans out only on success", async () => {
		seedDeleted("a", 2000);
		expect(await invoke("bin:restore", "a")).toBe(true);
		expect(repo.get("a")).toMatchObject({ id: "a" });
		expect(afterMutation).toHaveBeenCalledTimes(1);
		expect(await invoke("bin:restore", "a")).toBe(false); // already live
		expect(await invoke("bin:restore", 123)).toBe(false); // non-string id
		expect(afterMutation).toHaveBeenCalledTimes(1); // no extra fan-out
	});

	it("bin:purge purges and fans out only on success", async () => {
		seedDeleted("a", 2000);
		expect(await invoke("bin:purge", "a")).toBe(true);
		expect(await invoke("bin:list")).toEqual([]);
		expect(afterMutation).toHaveBeenCalledTimes(1);
		expect(await invoke("bin:purge", "a")).toBe(false); // gone
		expect(afterMutation).toHaveBeenCalledTimes(1);
	});

	it("bin:empty purges all and fans out once when it removed anything", async () => {
		seedDeleted("a", 2000);
		seedDeleted("b", 2000);
		expect(await invoke("bin:empty")).toBe(2);
		expect(afterMutation).toHaveBeenCalledTimes(1);
		expect(await invoke("bin:empty")).toBe(0); // empty → no fan-out
		expect(afterMutation).toHaveBeenCalledTimes(1);
	});

	it("degrades when no vault is open (getRepo → null)", async () => {
		handlers.clear();
		const noFan = vi.fn<() => void>();
		registerBinHandlers({
			getRepo: async () => null,
			deleteAsset: async () => {},
			afterMutation: noFan,
		});
		expect(await invoke("bin:list")).toEqual([]);
		expect(await invoke("bin:restore", "a")).toBe(false);
		expect(await invoke("bin:empty")).toBe(0);
		expect(noFan).not.toHaveBeenCalled();
	});

	describe("retention (9.8.8)", () => {
		let settingsRepo: SettingsRepository;

		beforeEach(async () => {
			handlers.clear();
			settingsRepo = new SettingsRepository(await stores.open("settings"));
			registerBinHandlers({
				getRepo: async () => repo,
				getSettingsRepo: async () => settingsRepo,
				deleteAsset: async () => {},
				afterMutation,
			});
		});

		it("get-retention defaults to 30 days; set-retention persists a preset", async () => {
			expect(await invoke("bin:get-retention")).toBe(30);
			expect(await invoke("bin:set-retention", 90)).toBe(90);
			expect(await invoke("bin:get-retention")).toBe(90);
			expect(await invoke("bin:set-retention", 0)).toBe(0); // forever
			expect(await invoke("bin:get-retention")).toBe(0);
		});

		it("set-retention fails closed on junk (keeps the stored value)", async () => {
			await invoke("bin:set-retention", 90);
			expect(await invoke("bin:set-retention", 13)).toBe(90); // not a preset
			expect(await invoke("bin:set-retention", "30")).toBe(90); // wrong type
			expect(await invoke("bin:set-retention", Number.NaN)).toBe(90);
			expect(await invoke("bin:get-retention")).toBe(90);
		});

		it("bin:list lazily purges items past the window and fans out", async () => {
			const DAY = 86_400_000;
			seedDeleted("ancient", Date.now() - 40 * DAY);
			seedDeleted("recent", Date.now() - 2 * DAY);
			const items = (await invoke("bin:list")) as Array<Record<string, unknown>>;
			expect(items.map((i) => i.id)).toEqual(["recent"]);
			expect(repo.get("ancient")).toBeNull(); // hard-deleted
			expect(afterMutation).toHaveBeenCalledTimes(1);
			// second list: nothing left to sweep → no extra fan-out
			await invoke("bin:list");
			expect(afterMutation).toHaveBeenCalledTimes(1);
		});

		it("retention forever disables the sweep", async () => {
			await invoke("bin:set-retention", 0);
			seedDeleted("ancient", 1); // epoch — decades past any window
			const items = (await invoke("bin:list")) as Array<Record<string, unknown>>;
			expect(items.map((i) => i.id)).toEqual(["ancient"]);
		});

		it("no policy store wired → never sweeps on a read (legacy wiring)", async () => {
			handlers.clear();
			registerBinHandlers({ getRepo: async () => repo, deleteAsset: async () => {}, afterMutation });
			seedDeleted("ancient", 1);
			const items = (await invoke("bin:list")) as Array<Record<string, unknown>>;
			expect(items.map((i) => i.id)).toEqual(["ancient"]);
			expect(await invoke("bin:get-retention")).toBe(30); // display default
		});
	});
});
