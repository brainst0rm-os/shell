import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { makeEnvelope } from "../../ipc/envelope";
import { handleYDocEnvelope } from "../../workers/ydoc/index";
import { base64ToBytes } from "../credentials/crypto";
import { DataStores } from "../storage/data-stores";
import { EntitiesRepository } from "../storage/entities-repo/entities-repo";
import { runWelcomeSeed } from "./run-welcome-seed";
import { WELCOME_SEED_VERSION, buildWelcomeStarterSet } from "./welcome-content";
import { WelcomeSeedOutcome } from "./welcome-seed";
import { readWelcomeSeedVersion } from "./welcome-seed-store";

const NOW = 1_700_000_000_000;

/** A real ydoc-worker-backed plant: persists the planted update to disk under
 *  the vault path, so a later `load` reads it back through the actual store. */
function ydocApply(vaultPath: string) {
	return async (entityId: string, updateB64: string): Promise<void> => {
		const reply = await handleYDocEnvelope(
			makeEnvelope({
				msg: `w${entityId}`,
				app: "io.brainstorm.shell",
				service: "ydoc",
				method: "applyUpdate",
				args: [{ vaultPath, entityId, updateB64 }],
				caps: [],
			}),
		);
		if (!reply.ok) throw new Error("ydoc applyUpdate failed");
	};
}

async function loadDocBytes(vaultPath: string, entityId: string): Promise<Uint8Array> {
	const reply = await handleYDocEnvelope(
		makeEnvelope({
			msg: `l${entityId}`,
			app: "io.brainstorm.shell",
			service: "ydoc",
			method: "load",
			args: [{ vaultPath, entityId }],
			caps: [],
		}),
	);
	if (!reply.ok) throw new Error("ydoc load failed");
	return base64ToBytes((reply.value as { snapshotB64: string }).snapshotB64);
}

describe("runWelcomeSeed (in-process, real entities repo + ydoc store)", () => {
	let vaultDir: string;
	let stores: DataStores;

	beforeEach(async () => {
		vaultDir = await mkdtemp(join(tmpdir(), "bs-welcome-"));
		stores = new DataStores(vaultDir);
	});
	afterEach(async () => {
		await rm(vaultDir, { recursive: true, force: true });
	});

	it("seeds all 8 starter entities and plants the 2 note bodies", async () => {
		const result = await runWelcomeSeed({
			session: { vaultPath: vaultDir, dataStores: stores },
			applyDocUpdate: ydocApply(vaultDir),
			now: NOW,
		});

		expect(result.outcome).toBe(WelcomeSeedOutcome.Seeded);
		expect(result.created).toBe(8);
		expect(result.planted).toBe(2);
		expect(result.errors).toEqual([]);

		const repo = new EntitiesRepository(await stores.open("entities"));
		expect(repo.query({}).length).toBe(8);

		// The two note bodies actually round-trip through the on-disk ydoc store.
		const withBody = buildWelcomeStarterSet(NOW).filter((e) => e.body);
		expect(withBody.length).toBe(2);
		for (const entity of withBody) {
			const bytes = await loadDocBytes(vaultDir, entity.id);
			const doc = new Y.Doc();
			Y.applyUpdate(doc, bytes);
			// @lexical/yjs stores the doc under the shared "root" key — a
			// planted body produces a non-trivial encoded state.
			expect(Y.encodeStateAsUpdate(doc).byteLength).toBeGreaterThan(16);
			doc.destroy();
		}
	});

	it("stamps the vault so a second run is a no-op (no duplicate entities)", async () => {
		const deps = {
			session: { vaultPath: vaultDir, dataStores: stores },
			applyDocUpdate: ydocApply(vaultDir),
			now: NOW,
		};
		await runWelcomeSeed(deps);
		expect(await readWelcomeSeedVersion(vaultDir)).toBe(WELCOME_SEED_VERSION);

		const second = await runWelcomeSeed(deps);
		expect(second.outcome).toBe(WelcomeSeedOutcome.AlreadySeeded);
		expect(second.created).toBe(0);

		const repo = new EntitiesRepository(await stores.open("entities"));
		expect(repo.query({}).length).toBe(8); // still 8, not 16
	});

	it("makes the seeded entities queryable by their own type (cross-app visible)", async () => {
		await runWelcomeSeed({
			session: { vaultPath: vaultDir, dataStores: stores },
			applyDocUpdate: ydocApply(vaultDir),
			now: NOW,
		});
		const repo = new EntitiesRepository(await stores.open("entities"));
		// e.g. the Task starter is visible to the Tasks app's type query.
		const taskType = buildWelcomeStarterSet(NOW).find((e) => e.type.includes("Task"))?.type;
		expect(taskType).toBeTruthy();
		if (taskType) expect(repo.query({ type: taskType }).length).toBe(1);
	});
});
