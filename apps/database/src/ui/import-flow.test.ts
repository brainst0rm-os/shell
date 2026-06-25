import { describe, expect, it, vi } from "vitest";
import type { ImportCommand } from "../logic/contact-import-plan";
import { type ImportEntitiesService, commitImportRun, summaryText } from "./import-flow";

const PERSON_TYPE = "brainstorm/Person/v1";

function makeEntities(overrides?: Partial<ImportEntitiesService>): ImportEntitiesService {
	return {
		create: vi.fn(async (type: string, properties: Record<string, unknown>) => ({
			id: `id_${(properties.name as string) ?? "new"}`,
		})),
		update: vi.fn(async () => ({})),
		...overrides,
	};
}

describe("commitImportRun", () => {
	it("dispatches create commands and tallies the created count", async () => {
		const commands: ImportCommand[] = [
			{ op: "create", properties: { name: "Ada" } },
			{ op: "create", properties: { name: "Grace" } },
		];
		const entities = makeEntities();
		const result = await commitImportRun(commands, entities, PERSON_TYPE);
		expect(result).toEqual({ created: 2, merged: 0, failed: 0 });
		expect(entities.create).toHaveBeenCalledTimes(2);
		expect(entities.create).toHaveBeenNthCalledWith(1, PERSON_TYPE, { name: "Ada" });
		expect(entities.create).toHaveBeenNthCalledWith(2, PERSON_TYPE, { name: "Grace" });
		expect(entities.update).not.toHaveBeenCalled();
	});

	it("dispatches update commands and tallies the merged count", async () => {
		const commands: ImportCommand[] = [
			{ op: "update", id: "p_ada", properties: { email: ["ada@new.com"] } },
		];
		const entities = makeEntities();
		const result = await commitImportRun(commands, entities, PERSON_TYPE);
		expect(result).toEqual({ created: 0, merged: 1, failed: 0 });
		expect(entities.update).toHaveBeenCalledWith("p_ada", { email: ["ada@new.com"] });
	});

	it("isolates per-command failure — one throw doesn't kill the batch", async () => {
		// Plan: create A (succeeds), update B (rejects), create C (succeeds).
		// Expect 2 succeed + 1 failure recorded, and the third create still
		// ran. Drift here would silently lose rows when one upstream broker
		// call rejects under load.
		const create = vi
			.fn()
			.mockImplementationOnce(async () => ({ id: "id_a" }))
			.mockImplementationOnce(async () => ({ id: "id_c" }));
		const update = vi.fn(async () => Promise.reject(new Error("conflict")));
		const entities: ImportEntitiesService = { create, update };
		const commands: ImportCommand[] = [
			{ op: "create", properties: { name: "A" } },
			{ op: "update", id: "p_b", properties: { name: "B" } },
			{ op: "create", properties: { name: "C" } },
		];
		const result = await commitImportRun(commands, entities, PERSON_TYPE);
		expect(result).toEqual({ created: 2, merged: 0, failed: 1 });
		expect(create).toHaveBeenCalledTimes(2);
		expect(update).toHaveBeenCalledTimes(1);
	});

	it("counts merge as failed when entities.update is unavailable (defense in depth)", async () => {
		const create = vi.fn(async () => ({ id: "id_a" }));
		// Update method intentionally absent.
		const entities: ImportEntitiesService = { create };
		const commands: ImportCommand[] = [
			{ op: "create", properties: { name: "A" } },
			{ op: "update", id: "p_b", properties: { name: "B" } },
		];
		const result = await commitImportRun(commands, entities, PERSON_TYPE);
		expect(result).toEqual({ created: 1, merged: 0, failed: 1 });
		// create still ran; the update branch was the one that failed-counted.
		expect(create).toHaveBeenCalledTimes(1);
	});

	it("empty command list → all-zero tally (idempotent no-op)", async () => {
		const entities = makeEntities();
		const result = await commitImportRun([], entities, PERSON_TYPE);
		expect(result).toEqual({ created: 0, merged: 0, failed: 0 });
		expect(entities.create).not.toHaveBeenCalled();
		expect(entities.update).not.toHaveBeenCalled();
	});

	it("create command uses the host-provided targetType, not a per-command type", async () => {
		// The ImportCommand shape (`{op:"create", properties}`) deliberately
		// doesn't carry the target type — the host knows from the mapper. A
		// future refactor that adds `type` to the command must not silently
		// override the host's choice; this test pins the contract.
		const entities = makeEntities();
		const commands: ImportCommand[] = [{ op: "create", properties: { name: "X" } }];
		await commitImportRun(commands, entities, "brainstorm/Custom/v1");
		expect(entities.create).toHaveBeenCalledWith("brainstorm/Custom/v1", { name: "X" });
	});
});

describe("summaryText", () => {
	it("formats every count separately when non-zero", () => {
		expect(summaryText({ create: 3, merge: 2, skip: 1 })).toBe("3 new · 2 merge · 1 skip");
	});

	it("suppresses zero counts (clean copy, no '0 to merge')", () => {
		expect(summaryText({ create: 5, merge: 0, skip: 0 })).toBe("5 new");
		expect(summaryText({ create: 0, merge: 2, skip: 0 })).toBe("2 merge");
		expect(summaryText({ create: 0, merge: 0, skip: 4 })).toBe("4 skip");
		expect(summaryText({ create: 3, merge: 0, skip: 1 })).toBe("3 new · 1 skip");
	});

	it("returns 'Nothing to import' when every count is zero", () => {
		// Distinguishable string the dialog uses to disable the Import
		// button — keeps the empty case from showing a "Import" CTA that
		// would be a no-op.
		expect(summaryText({ create: 0, merge: 0, skip: 0 })).toBe("Nothing to import");
	});
});
