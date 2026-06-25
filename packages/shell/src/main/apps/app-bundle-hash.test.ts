import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectBundleFiles, hashBundleDirectory } from "./app-bundle-hash";

async function writeFiles(dir: string, files: Record<string, string>): Promise<void> {
	for (const [rel, contents] of Object.entries(files)) {
		const abs = join(dir, rel);
		await mkdir(join(abs, ".."), { recursive: true });
		await writeFile(abs, contents, "utf8");
	}
}

describe("hashBundleDirectory", () => {
	let dirA: string;
	let dirB: string;

	beforeEach(async () => {
		dirA = await mkdtemp(join(tmpdir(), "bundle-hash-a-"));
		dirB = await mkdtemp(join(tmpdir(), "bundle-hash-b-"));
	});

	afterEach(async () => {
		await rm(dirA, { recursive: true, force: true });
		await rm(dirB, { recursive: true, force: true });
	});

	it("is a stable hex sha256 over the bundle content", async () => {
		await writeFiles(dirA, {
			"index.html": "<!doctype html>",
			"dist/app.js": "console.log(1)",
		});
		const hash = await hashBundleDirectory(dirA);
		expect(hash).toMatch(/^[0-9a-f]{64}$/);
		expect(await hashBundleDirectory(dirA)).toBe(hash);
	});

	it("hashes identically regardless of file-creation order (reorder stability)", async () => {
		await writeFiles(dirA, {
			"a.txt": "alpha",
			"b.txt": "bravo",
			"nested/c.txt": "charlie",
		});
		// Same content, written in the reverse order into a different dir.
		await writeFiles(dirB, {
			"nested/c.txt": "charlie",
			"b.txt": "bravo",
			"a.txt": "alpha",
		});
		expect(await hashBundleDirectory(dirB)).toBe(await hashBundleDirectory(dirA));
	});

	it("changes when any file's content changes", async () => {
		await writeFiles(dirA, { "x.js": "v1" });
		const before = await hashBundleDirectory(dirA);
		await writeFiles(dirA, { "x.js": "v2" });
		expect(await hashBundleDirectory(dirA)).not.toBe(before);
	});

	it("changes when a file moves to a different path (path is part of the hash)", async () => {
		await writeFiles(dirA, { "dir/x.js": "same" });
		await writeFiles(dirB, { "x.js": "same" });
		expect(await hashBundleDirectory(dirB)).not.toBe(await hashBundleDirectory(dirA));
	});

	it("length-prefix framing prevents path/content collisions", async () => {
		// `a/b` + content `c` must not collide with file `a` + content `bc`.
		await writeFiles(dirA, { "a/b": "c" });
		await writeFiles(dirB, { a: "bc" });
		expect(await hashBundleDirectory(dirB)).not.toBe(await hashBundleDirectory(dirA));
	});

	it("resists second-preimage collisions where content absorbs a field boundary", async () => {
		// Without length prefixes, a two-file bundle {a:"Z", b:"Y"} and a
		// single-file bundle {a:"Z\0...b...Y"} could be shaped to hash equal
		// (content swallows the next file's path/separator). The 8-byte length
		// prefix on every path + content makes the framing unambiguous.
		await writeFiles(dirA, { a: "Z", b: "Y" });
		await writeFiles(dirB, { a: "Zb\0Y" });
		expect(await hashBundleDirectory(dirB)).not.toBe(await hashBundleDirectory(dirA));
	});

	it("collectBundleFiles walks nested files recursively", async () => {
		await writeFiles(dirA, {
			"top.txt": "1",
			"sub/one.txt": "2",
			"sub/deep/two.txt": "3",
		});
		const files = (await collectBundleFiles(dirA)).sort();
		expect(files).toEqual(["sub/deep/two.txt", "sub/one.txt", "top.txt"]);
	});
});
