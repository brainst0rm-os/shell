import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bindingsPath, clearBindings, readBindings, writeBindings } from "./bindings-store";

describe("shortcut bindings store", () => {
	let vaultDir: string;

	beforeEach(async () => {
		vaultDir = await mkdtemp(join(tmpdir(), "brainstorm-bindings-"));
	});

	afterEach(async () => {
		await rm(vaultDir, { recursive: true, force: true });
	});

	it("returns an empty file on miss", async () => {
		const file = await readBindings(vaultDir);
		expect(file.overrides).toEqual([]);
	});

	it("write + read round-trips overrides", async () => {
		await writeBindings(vaultDir, [
			{ id: "shell/launcher", chord: "CmdOrCtrl+P" },
			{ id: "io.example.editor/format-bold", chord: null },
		]);
		const file = await readBindings(vaultDir);
		expect(file.overrides).toEqual([
			{ id: "shell/launcher", chord: "CmdOrCtrl+P" },
			{ id: "io.example.editor/format-bold", chord: null },
		]);
	});

	it("creates the shell/ directory if missing", async () => {
		await writeBindings(vaultDir, [{ id: "shell/launcher", chord: "X" }]);
		expect((await readBindings(vaultDir)).overrides).toHaveLength(1);
	});

	it("clearBindings removes the file", async () => {
		await writeBindings(vaultDir, [{ id: "x", chord: "y" }]);
		await clearBindings(vaultDir);
		expect((await readBindings(vaultDir)).overrides).toEqual([]);
	});

	it("drops malformed entries, keeping the well-formed ones", async () => {
		await mkdir(join(vaultDir, "shell"), { recursive: true });
		await writeFile(
			bindingsPath(vaultDir),
			JSON.stringify({
				version: 1,
				overrides: [
					{ id: "shell/launcher", chord: "P" },
					{ id: "", chord: "x" }, // bad: empty id
					{ id: "ok-but-numeric-chord", chord: 42 }, // bad: non-string non-null
					{ id: "cleared/ok", chord: null }, // ok
				],
			}),
			"utf8",
		);
		const file = await readBindings(vaultDir);
		expect(file.overrides.map((o) => o.id).sort()).toEqual(["cleared/ok", "shell/launcher"]);
	});

	it("returns empty on bad JSON", async () => {
		await mkdir(join(vaultDir, "shell"), { recursive: true });
		await writeFile(bindingsPath(vaultDir), "{ not json", "utf8");
		expect((await readBindings(vaultDir)).overrides).toEqual([]);
	});

	it("returns empty on wrong format version", async () => {
		await mkdir(join(vaultDir, "shell"), { recursive: true });
		await writeFile(bindingsPath(vaultDir), JSON.stringify({ version: 999, overrides: [] }), "utf8");
		expect((await readBindings(vaultDir)).overrides).toEqual([]);
	});
});
