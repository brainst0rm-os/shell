import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Envelope } from "../../ipc/envelope";
import { readSpellcheckDictionary } from "../vault/vault-spellcheck-dictionary-store";
import { makeSpellcheckServiceHandler } from "./spellcheck-service";

const env = (method: string, word?: string): Envelope =>
	({
		v: 1,
		msg: "m",
		app: "io.brainstorm.notes",
		service: "spellcheck",
		method,
		args: word === undefined ? [] : [{ word }],
		caps: [],
	}) as Envelope;

describe("makeSpellcheckServiceHandler", () => {
	let dir: string;
	let sink: {
		add: ReturnType<typeof vi.fn<(word: string) => void>>;
		remove: ReturnType<typeof vi.fn<(word: string) => void>>;
	};
	let handler: ReturnType<typeof makeSpellcheckServiceHandler>;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "bs-spell-svc-"));
		sink = { add: vi.fn<(word: string) => void>(), remove: vi.fn<(word: string) => void>() };
		handler = makeSpellcheckServiceHandler({ getVaultPath: () => dir, sink });
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("addWord persists + adds to the session sink, returning the list", async () => {
		const result = await handler(env("addWord", "Brainstorm"));
		expect(result).toEqual(["Brainstorm"]);
		expect(sink.add).toHaveBeenCalledWith("Brainstorm");
		expect(await readSpellcheckDictionary(dir)).toEqual(["Brainstorm"]);
	});

	it("removeWord un-persists + removes from the sink", async () => {
		await handler(env("addWord", "Brainstorm"));
		const result = await handler(env("removeWord", "brainstorm"));
		expect(result).toEqual([]);
		expect(sink.remove).toHaveBeenCalledWith("brainstorm");
		expect(await readSpellcheckDictionary(dir)).toEqual([]);
	});

	it("ignoreWord adds to the sink WITHOUT persisting", async () => {
		const result = await handler(env("ignoreWord", "teh"));
		expect(result).toBeUndefined();
		expect(sink.add).toHaveBeenCalledWith("teh");
		expect(await readSpellcheckDictionary(dir)).toEqual([]);
	});

	it("listWords reads the persisted list", async () => {
		await handler(env("addWord", "Yjs"));
		expect(await handler(env("listWords"))).toEqual(["Yjs"]);
	});

	it("rejects a blank word", async () => {
		await expect(handler(env("addWord", "  "))).rejects.toThrow(/non-empty/);
	});

	it("fails closed when no vault is open", async () => {
		const h = makeSpellcheckServiceHandler({ getVaultPath: () => null, sink });
		await expect(h(env("listWords"))).rejects.toThrow(/no active vault/);
	});

	it("rejects an unknown method", async () => {
		await expect(handler(env("frobnicate"))).rejects.toThrow(/unknown spellcheck method/);
	});
});
