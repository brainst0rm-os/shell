/**
 * `blocks` broker service handler — method routing, arg validation, the
 * Unavailable/Invalid contract, and the read-only registry behaviour.
 * The broker enforces `blocks.read` from the envelope `caps`; these
 * tests pin the handler contract it hands off to.
 */

import { describe, expect, it } from "vitest";
import type { Envelope } from "../../ipc/envelope";
import { BLOCK_ID_PATTERN } from "../apps/block-id";
import type { BlockRecord, BlocksRepository } from "../storage/registry-repo/blocks-repo";
import { makeBlocksServiceHandler } from "./blocks-service";

function env(method: string, args: unknown[]): Envelope {
	return { v: 1, msg: "m1", app: "io.test.app", service: "blocks", method, args, caps: [] };
}

const ROWS: BlockRecord[] = [
	{ id: "io.example.db/grid", appId: "io.example.db", name: "Grid", registeredAt: 2 },
	{ id: "io.example.notes/p", appId: "io.example.notes", name: "P", registeredAt: 1 },
];

const SOURCES: Record<string, string> = { "io.example.db/grid": "/* grid bundle */" };
const FOR_TYPE: Record<string, string> = { "brainstorm/List/v1": "io.example.db/grid" };

function fakeRepo(): BlocksRepository {
	return {
		listAll: () => ROWS,
		getById: (id: string) => ROWS.find((r) => r.id === id) ?? null,
		getSource: (id: string) => SOURCES[id] ?? null,
		forType: (type: string) => FOR_TYPE[type] ?? null,
	} as unknown as BlocksRepository;
}

const present = makeBlocksServiceHandler({ getBlocksRepo: async () => fakeRepo() });
const noSession = makeBlocksServiceHandler({ getBlocksRepo: async () => null });

describe("blocks service — list", () => {
	it("returns every registered block", async () => {
		expect(await present(env("list", []))).toEqual(ROWS);
	});
});

describe("blocks service — resolve", () => {
	it("resolves a known block id to its providing-app record", async () => {
		expect(await present(env("resolve", [{ blockId: "io.example.notes/p" }]))).toEqual(ROWS[1]);
	});

	it("resolves an unknown (well-formed) block id to null, not an error", async () => {
		expect(await present(env("resolve", [{ blockId: "io.example.notes/missing" }]))).toBeNull();
	});

	it("rejects a missing / non-object / empty / malformed blockId as Invalid", async () => {
		for (const args of [
			[],
			[null],
			["str"],
			[{}],
			[{ blockId: "" }],
			[{ blockId: 42 }],
			[{ blockId: "no-slash" }],
			[{ blockId: "a/b/c" }],
		]) {
			await expect(present(env("resolve", args))).rejects.toMatchObject({ name: "Invalid" });
		}
	});
});

describe("blocks service — source", () => {
	it("returns the block bundle source for a block that ships one", async () => {
		expect(await present(env("source", [{ blockId: "io.example.db/grid" }]))).toBe(
			"/* grid bundle */",
		);
	});

	it("returns null for a registered block with no bundle", async () => {
		expect(await present(env("source", [{ blockId: "io.example.notes/p" }]))).toBeNull();
	});

	it("returns null for an unknown (well-formed) block id", async () => {
		expect(await present(env("source", [{ blockId: "io.example.db/missing" }]))).toBeNull();
	});

	it("rejects a malformed blockId as Invalid (same gate as resolve)", async () => {
		await expect(present(env("source", [{ blockId: "no-slash" }]))).rejects.toMatchObject({
			name: "Invalid",
		});
	});

	it("is Unavailable with no active vault session", async () => {
		await expect(noSession(env("source", [{ blockId: "io.example.db/grid" }]))).rejects.toMatchObject(
			{ name: "Unavailable" },
		);
	});
});

describe("blocks service — forType", () => {
	it("returns the block id that renders an entity type", async () => {
		expect(await present(env("forType", [{ entityType: "brainstorm/List/v1" }]))).toBe(
			"io.example.db/grid",
		);
	});

	it("returns null when no block claims the type", async () => {
		expect(await present(env("forType", [{ entityType: "brainstorm/Note/v1" }]))).toBeNull();
	});

	it("rejects a missing / empty entityType as Invalid", async () => {
		for (const args of [[], [{}], [{ entityType: "" }], [{ entityType: 7 }]]) {
			await expect(present(env("forType", args))).rejects.toMatchObject({ name: "Invalid" });
		}
	});
});

describe("blocks service — contract", () => {
	it("throws Unavailable when no vault session is active", async () => {
		await expect(noSession(env("list", []))).rejects.toMatchObject({ name: "Unavailable" });
		await expect(
			noSession(env("resolve", [{ blockId: "io.example.notes/p" }])),
		).rejects.toMatchObject({ name: "Unavailable" });
	});

	it("throws Invalid for an unknown method", async () => {
		await expect(present(env("register", [{}]))).rejects.toMatchObject({ name: "Invalid" });
	});
});

describe("blocks service — grammar drift fence", () => {
	// Two-sided drift fence: the SDK's 9.4.3 block-renderer registry
	// (packages/sdk/src/block-registry/registry.ts → SDK_BLOCK_ID_PATTERN)
	// re-implements this exact regex because the SDK is a leaf package and
	// can't import from the shell. The SDK side has its own literal-
	// equality fence; this is the shell side asserting the same string —
	// so a unilateral edit to either copy breaks at least one test.
	it("BLOCK_ID_PATTERN literal stays in lockstep with the SDK copy", () => {
		expect(BLOCK_ID_PATTERN.source).toBe("^[A-Za-z0-9._-]+\\/[A-Za-z0-9._-]+$");
		expect(BLOCK_ID_PATTERN.flags).toBe("");
	});
});
