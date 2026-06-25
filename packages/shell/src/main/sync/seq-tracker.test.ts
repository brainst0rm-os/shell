import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEQ_TRACKER_FILENAME, SeqAcceptance, SeqTracker, seqTrackerPath } from "./seq-tracker";

const SENDER_A = new Uint8Array(32).fill(0xa1);
const SENDER_B = new Uint8Array(32).fill(0xb2);

describe("SeqTracker", () => {
	let vaultPath: string;

	beforeEach(async () => {
		vaultPath = await mkdtemp(join(tmpdir(), "bs-seq-tracker-"));
	});

	afterEach(async () => {
		await rm(vaultPath, { recursive: true, force: true });
	});

	it("nextSeq returns 0 on first call and increments monotonically per pair", async () => {
		const tracker = await SeqTracker.open(vaultPath);
		expect(await tracker.nextSeq(SENDER_A, "ent_x")).toBe(0);
		expect(await tracker.nextSeq(SENDER_A, "ent_x")).toBe(1);
		expect(await tracker.nextSeq(SENDER_A, "ent_x")).toBe(2);
		expect(await tracker.nextSeq(SENDER_A, "ent_y")).toBe(0);
		expect(await tracker.nextSeq(SENDER_B, "ent_x")).toBe(0);
		await tracker.dispose();
	});

	it("accept marks Fresh on first sight, Duplicate on exact replay", async () => {
		const tracker = await SeqTracker.open(vaultPath);
		expect(await tracker.accept(SENDER_A, "ent_x", 0)).toBe(SeqAcceptance.Fresh);
		expect(await tracker.accept(SENDER_A, "ent_x", 0)).toBe(SeqAcceptance.Duplicate);
		expect(await tracker.accept(SENDER_A, "ent_x", 1)).toBe(SeqAcceptance.Fresh);
		expect(await tracker.accept(SENDER_A, "ent_x", 1)).toBe(SeqAcceptance.Duplicate);
		await tracker.dispose();
	});

	it("accept rejects an ancient seq as OutOfWindow", async () => {
		const tracker = await SeqTracker.open(vaultPath, { windowBits: 64 });
		expect(await tracker.accept(SENDER_A, "ent_x", 128)).toBe(SeqAcceptance.Fresh);
		expect(await tracker.accept(SENDER_A, "ent_x", 0)).toBe(SeqAcceptance.OutOfWindow);
		expect(await tracker.accept(SENDER_A, "ent_x", 64)).toBe(SeqAcceptance.OutOfWindow);
		expect(await tracker.accept(SENDER_A, "ent_x", 65)).toBe(SeqAcceptance.Fresh);
		await tracker.dispose();
	});

	it("accept handles gap-then-late-arrival within window (N=10 then N=5 Fresh once Duplicate twice)", async () => {
		const tracker = await SeqTracker.open(vaultPath);
		expect(await tracker.accept(SENDER_A, "ent_x", 10)).toBe(SeqAcceptance.Fresh);
		expect(await tracker.accept(SENDER_A, "ent_x", 5)).toBe(SeqAcceptance.Fresh);
		expect(await tracker.accept(SENDER_A, "ent_x", 5)).toBe(SeqAcceptance.Duplicate);
		expect(await tracker.accept(SENDER_A, "ent_x", 5)).toBe(SeqAcceptance.Duplicate);
		expect(await tracker.accept(SENDER_A, "ent_x", 10)).toBe(SeqAcceptance.Duplicate);
		await tracker.dispose();
	});

	it("gap of N=128 still rejects re-arrival of N=0 but accepts N=129", async () => {
		const tracker = await SeqTracker.open(vaultPath, { windowBits: 64 });
		expect(await tracker.accept(SENDER_A, "ent_x", 0)).toBe(SeqAcceptance.Fresh);
		expect(await tracker.accept(SENDER_A, "ent_x", 128)).toBe(SeqAcceptance.Fresh);
		expect(await tracker.accept(SENDER_A, "ent_x", 0)).toBe(SeqAcceptance.OutOfWindow);
		expect(await tracker.accept(SENDER_A, "ent_x", 129)).toBe(SeqAcceptance.Fresh);
		expect(await tracker.accept(SENDER_A, "ent_x", 129)).toBe(SeqAcceptance.Duplicate);
		await tracker.dispose();
	});

	it("distinct (sender, entityId) pairs are independent", async () => {
		const tracker = await SeqTracker.open(vaultPath);
		expect(await tracker.accept(SENDER_A, "ent_x", 5)).toBe(SeqAcceptance.Fresh);
		expect(await tracker.accept(SENDER_A, "ent_y", 5)).toBe(SeqAcceptance.Fresh);
		expect(await tracker.accept(SENDER_B, "ent_x", 5)).toBe(SeqAcceptance.Fresh);
		expect(await tracker.accept(SENDER_A, "ent_x", 5)).toBe(SeqAcceptance.Duplicate);
		expect(await tracker.accept(SENDER_A, "ent_y", 5)).toBe(SeqAcceptance.Duplicate);
		expect(await tracker.accept(SENDER_B, "ent_x", 5)).toBe(SeqAcceptance.Duplicate);
		await tracker.dispose();
	});

	it("persistence round-trip: close + reopen tracker keeps receive + send state", async () => {
		const t1 = await SeqTracker.open(vaultPath);
		expect(await t1.nextSeq(SENDER_A, "ent_x")).toBe(0);
		expect(await t1.nextSeq(SENDER_A, "ent_x")).toBe(1);
		expect(await t1.accept(SENDER_B, "ent_x", 7)).toBe(SeqAcceptance.Fresh);
		expect(await t1.accept(SENDER_B, "ent_x", 5)).toBe(SeqAcceptance.Fresh);
		await t1.dispose();

		const t2 = await SeqTracker.open(vaultPath);
		expect(await t2.nextSeq(SENDER_A, "ent_x")).toBe(2);
		expect(await t2.accept(SENDER_B, "ent_x", 7)).toBe(SeqAcceptance.Duplicate);
		expect(await t2.accept(SENDER_B, "ent_x", 5)).toBe(SeqAcceptance.Duplicate);
		expect(await t2.accept(SENDER_B, "ent_x", 8)).toBe(SeqAcceptance.Fresh);
		await t2.dispose();
	});

	it("custom windowBits=8 still drops out-of-window correctly", async () => {
		const tracker = await SeqTracker.open(vaultPath, { windowBits: 8 });
		expect(await tracker.accept(SENDER_A, "ent_x", 7)).toBe(SeqAcceptance.Fresh);
		expect(await tracker.accept(SENDER_A, "ent_x", 0)).toBe(SeqAcceptance.Fresh);
		expect(await tracker.accept(SENDER_A, "ent_x", 0)).toBe(SeqAcceptance.Duplicate);
		expect(await tracker.accept(SENDER_A, "ent_x", 14)).toBe(SeqAcceptance.Fresh);
		expect(await tracker.accept(SENDER_A, "ent_x", 7)).toBe(SeqAcceptance.Duplicate);
		expect(await tracker.accept(SENDER_A, "ent_x", 15)).toBe(SeqAcceptance.Fresh);
		expect(await tracker.accept(SENDER_A, "ent_x", 7)).toBe(SeqAcceptance.OutOfWindow);
		await tracker.dispose();
	});

	it("dispose is idempotent and rejects subsequent calls", async () => {
		const tracker = await SeqTracker.open(vaultPath);
		await tracker.dispose();
		await tracker.dispose();
		await expect(tracker.nextSeq(SENDER_A, "ent_x")).rejects.toThrow(/disposed/);
		await expect(tracker.accept(SENDER_A, "ent_x", 0)).rejects.toThrow(/disposed/);
	});

	it("rejects empty entityId on both nextSeq and accept", async () => {
		const tracker = await SeqTracker.open(vaultPath);
		await expect(tracker.nextSeq(SENDER_A, "")).rejects.toThrow(/non-empty/);
		await expect(tracker.accept(SENDER_A, "", 0)).rejects.toThrow(/non-empty/);
		await tracker.dispose();
	});

	it("rejects non-integer / negative seq on accept", async () => {
		const tracker = await SeqTracker.open(vaultPath);
		await expect(tracker.accept(SENDER_A, "ent_x", -1)).rejects.toThrow(/non-negative/);
		await expect(tracker.accept(SENDER_A, "ent_x", 1.5)).rejects.toThrow(/non-negative/);
		await tracker.dispose();
	});

	it("rejects out-of-range windowBits at open", async () => {
		await expect(SeqTracker.open(vaultPath, { windowBits: 0 })).rejects.toThrow(/windowBits/);
		await expect(SeqTracker.open(vaultPath, { windowBits: 65 })).rejects.toThrow(/windowBits/);
		await expect(SeqTracker.open(vaultPath, { windowBits: 1.5 })).rejects.toThrow(/windowBits/);
	});

	it("persists to <vault>/sync/seq.json with the documented filename", async () => {
		const tracker = await SeqTracker.open(vaultPath);
		await tracker.nextSeq(SENDER_A, "ent_x");
		await tracker.dispose();
		const expected = seqTrackerPath(vaultPath);
		expect(expected.endsWith(SEQ_TRACKER_FILENAME)).toBe(true);
		const raw = await readFile(expected, "utf8");
		const parsed = JSON.parse(raw) as { version: number; send: Record<string, number> };
		expect(parsed.version).toBe(1);
		expect(Object.values(parsed.send)).toContain(0);
	});

	it("malformed on-disk JSON is treated as empty (no throw)", async () => {
		const t1 = await SeqTracker.open(vaultPath);
		await t1.nextSeq(SENDER_A, "ent_x");
		await t1.dispose();
		const { writeFile } = await import("node:fs/promises");
		await writeFile(seqTrackerPath(vaultPath), "{not json", "utf8");
		const t2 = await SeqTracker.open(vaultPath);
		expect(await t2.nextSeq(SENDER_A, "ent_x")).toBe(0);
		await t2.dispose();
	});

	it("interleaved concurrent accepts persist consistently", async () => {
		const tracker = await SeqTracker.open(vaultPath);
		const results = await Promise.all(
			Array.from({ length: 20 }, (_, i) => tracker.accept(SENDER_A, "ent_x", i)),
		);
		expect(results.filter((r) => r === SeqAcceptance.Fresh).length).toBe(20);
		const reseen = await Promise.all(
			Array.from({ length: 20 }, (_, i) => tracker.accept(SENDER_A, "ent_x", i)),
		);
		expect(reseen.every((r) => r === SeqAcceptance.Duplicate)).toBe(true);
		await tracker.dispose();
	});
});
