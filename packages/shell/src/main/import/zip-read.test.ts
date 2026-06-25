/**
 * IE-6 zip reader. A tiny in-test PKZIP writer (stored + deflate) feeds the
 * reader so the happy path, both compression methods, the zip-slip guard, and
 * the size/count limits are exercised without a fixture file.
 */

import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { type ZipReadLimits, readZip, zipEntryText } from "./zip-read";

const LIMITS: ZipReadLimits = { maxEntries: 1000, maxEntryBytes: 1 << 20, maxTotalBytes: 8 << 20 };

type Member = { name: string; data: Buffer; deflate?: boolean };

/** Build a minimal valid PKZIP archive (local headers + central dir + EOCD). */
function makeZip(members: Member[]): Uint8Array {
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;
	for (const m of members) {
		const nameBuf = Buffer.from(m.name, "utf8");
		const stored = m.deflate ? zlib.deflateRawSync(m.data) : m.data;
		const method = m.deflate ? 8 : 0;
		const local = Buffer.alloc(30 + nameBuf.length);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(method, 8);
		local.writeUInt32LE(stored.length, 18);
		local.writeUInt32LE(m.data.length, 22);
		local.writeUInt16LE(nameBuf.length, 26);
		nameBuf.copy(local, 30);
		const localRecord = Buffer.concat([local, stored]);

		const central = Buffer.alloc(46 + nameBuf.length);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(method, 10);
		central.writeUInt32LE(stored.length, 20);
		central.writeUInt32LE(m.data.length, 24);
		central.writeUInt16LE(nameBuf.length, 28);
		central.writeUInt32LE(offset, 42);
		nameBuf.copy(central, 46);

		locals.push(localRecord);
		centrals.push(central);
		offset += localRecord.length;
	}
	const localBlock = Buffer.concat(locals);
	const centralBlock = Buffer.concat(centrals);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(members.length, 8);
	eocd.writeUInt16LE(members.length, 10);
	eocd.writeUInt32LE(centralBlock.length, 12);
	eocd.writeUInt32LE(localBlock.length, 16);
	return new Uint8Array(Buffer.concat([localBlock, centralBlock, eocd]));
}

describe("readZip", () => {
	it("reads stored + deflate entries and decodes text", () => {
		const zip = makeZip([
			{ name: "a/note.md", data: Buffer.from("# Hi\n") },
			{ name: "b/data.csv", data: Buffer.from("Name\nX\n"), deflate: true },
		]);
		const [first, second] = readZip(zip, LIMITS);
		expect([first?.path, second?.path]).toEqual(["a/note.md", "b/data.csv"]);
		expect(first && zipEntryText(first)).toBe("# Hi\n");
		expect(second && zipEntryText(second)).toBe("Name\nX\n");
	});

	it("skips directory entries and rejects zip-slip paths", () => {
		const zip = makeZip([
			{ name: "dir/", data: Buffer.from("") },
			{ name: "../escape.md", data: Buffer.from("nope") },
			{ name: "/abs.md", data: Buffer.from("nope") },
			{ name: "ok.md", data: Buffer.from("yes") },
		]);
		const entries = readZip(zip, LIMITS);
		expect(entries.map((e) => e.path)).toEqual(["ok.md"]);
	});

	it("enforces the per-entry, total, and count limits", () => {
		const big = makeZip([{ name: "big.bin", data: Buffer.alloc(2048) }]);
		expect(() => readZip(big, { ...LIMITS, maxEntryBytes: 1024 })).toThrow(/exceeds 1024 bytes/);

		const many = makeZip([
			{ name: "1.md", data: Buffer.from("a") },
			{ name: "2.md", data: Buffer.from("b") },
		]);
		expect(() => readZip(many, { ...LIMITS, maxEntries: 1 })).toThrow(/exceeds 1 entries/);

		const total = makeZip([
			{ name: "1.md", data: Buffer.alloc(600) },
			{ name: "2.md", data: Buffer.alloc(600) },
		]);
		expect(() => readZip(total, { ...LIMITS, maxTotalBytes: 1000 })).toThrow(/too large/);
	});

	it("throws on a non-zip buffer", () => {
		expect(() => readZip(new Uint8Array([1, 2, 3, 4]), LIMITS)).toThrow(/not a zip/);
	});
});
