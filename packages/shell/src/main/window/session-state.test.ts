import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type SessionState,
	clearSession,
	readSession,
	sessionPath,
	writeSession,
} from "./session-state";

const sample: SessionState = {
	version: 1,
	windows: [
		{
			appId: "shell",
			windowId: "dashboard",
			monitorId: "mon_v1:abcd0001",
			placement: { x: 100, y: 100, width: 1280, height: 800 },
			updatedAt: 1715473200000,
		},
	],
	lastClosedAt: 1715473200000,
};

describe("session-state", () => {
	let vaultDir: string;

	beforeEach(async () => {
		vaultDir = await mkdtemp(join(tmpdir(), "brainstorm-session-"));
	});

	afterEach(async () => {
		await rm(vaultDir, { recursive: true, force: true });
	});

	it("returns an empty session when the file is missing", async () => {
		const state = await readSession(vaultDir);
		expect(state.windows).toEqual([]);
		expect(state.lastClosedAt).toBeNull();
	});

	it("write + read round-trip", async () => {
		await writeSession(vaultDir, sample);
		const read = await readSession(vaultDir);
		expect(read).toEqual(sample);
	});

	it("creates the shell/ directory if missing", async () => {
		await writeSession(vaultDir, sample);
		const raw = await readFile(sessionPath(vaultDir), "utf8");
		expect(raw).toContain('"version": 1');
	});

	it("clearSession removes the file", async () => {
		await writeSession(vaultDir, sample);
		await clearSession(vaultDir);
		expect((await readSession(vaultDir)).windows).toEqual([]);
	});

	it("rejects rows with malformed placement, leaving the good ones", async () => {
		await mkdir(join(vaultDir, "shell"), { recursive: true });
		await writeFile(
			sessionPath(vaultDir),
			JSON.stringify({
				version: 1,
				windows: [
					{
						appId: "shell",
						windowId: "good",
						monitorId: "mon_v1:1",
						placement: { x: 0, y: 0, width: 100, height: 100 },
						updatedAt: 1,
					},
					{
						appId: "shell",
						windowId: "broken",
						monitorId: "mon_v1:2",
						placement: { x: "not a number", y: 0, width: 1, height: 1 },
						updatedAt: 2,
					},
				],
				lastClosedAt: null,
			}),
			"utf8",
		);
		const state = await readSession(vaultDir);
		expect(state.windows.map((w) => w.windowId)).toEqual(["good"]);
	});

	it("returns an empty session when the file is invalid JSON", async () => {
		await mkdir(join(vaultDir, "shell"), { recursive: true });
		await writeFile(sessionPath(vaultDir), "{ not json", "utf8");
		const state = await readSession(vaultDir);
		expect(state.windows).toEqual([]);
	});

	it("returns an empty session when the version is wrong", async () => {
		await mkdir(join(vaultDir, "shell"), { recursive: true });
		await writeFile(sessionPath(vaultDir), JSON.stringify({ version: 999, windows: [] }), "utf8");
		const state = await readSession(vaultDir);
		expect(state.windows).toEqual([]);
	});
});
