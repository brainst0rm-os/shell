import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	DEFAULT_AUDIT_ROTATE_BYTES,
	DEFAULT_READ_LIMIT,
	DEFAULT_READ_WINDOW_MS,
	DEFAULT_TOP_HOSTS_PER_APP,
	NetworkAuditOutcome,
	type NetworkAuditRecord,
	filterBlockedRecords,
	hostOf,
	makeFileAuditSink,
	networkEgressHostOf,
	pathOf,
	readAuditRecords,
	rotatedPathFor,
	summarizePerApp,
} from "./audit-log";

function rec(overrides: Partial<NetworkAuditRecord> = {}): NetworkAuditRecord {
	return {
		ts: 1_700_000_000_000,
		appId: "io.brainstorm.notes",
		method: "GET",
		host: "example.com",
		path: "/",
		status: 200,
		bytes: 1024,
		durationMs: 42,
		outcome: NetworkAuditOutcome.Completed,
		reason: "",
		...overrides,
	};
}

describe("rotatedPathFor", () => {
	it("inserts `.1` before the extension", () => {
		expect(rotatedPathFor("/var/log/network-audit.jsonl")).toBe("/var/log/network-audit.1.jsonl");
	});

	it("appends `.1` when there is no extension", () => {
		expect(rotatedPathFor("/var/log/network-audit")).toBe("/var/log/network-audit.1");
	});

	it("ignores extensions longer than 7 chars (treats them as part of the filename)", () => {
		// `verylongext` past the 7-char threshold — falls back to the
		// no-extension form so we don't mangle the original name.
		const out = rotatedPathFor("/var/log/network-audit.verylongext");
		expect(out).toBe("/var/log/network-audit.verylongext.1");
	});
});

describe("hostOf / pathOf — query + fragment hygiene", () => {
	it("pathOf drops `?query`", () => {
		expect(pathOf("https://example.com/foo/bar?token=secret")).toBe("/foo/bar");
	});

	it("pathOf drops `#fragment`", () => {
		expect(pathOf("https://example.com/foo#section")).toBe("/foo");
	});

	it("hostOf strips default ports", () => {
		expect(hostOf("https://example.com:443/")).toBe("example.com");
		expect(hostOf("http://example.com:80/")).toBe("example.com");
	});

	it("hostOf preserves non-default ports as `host:port`", () => {
		expect(hostOf("https://example.com:8443/")).toBe("example.com:8443");
	});

	it("pathOf returns empty on malformed URLs (defensive)", () => {
		expect(pathOf("not a url")).toBe("");
	});
});

describe("networkEgressHostOf — only real over-the-wire schemes", () => {
	it("returns the host for http(s) and ws(s)", () => {
		expect(networkEgressHostOf("https://example.com/x")).toBe("example.com");
		expect(networkEgressHostOf("http://example.com:8080/x")).toBe("example.com:8080");
		expect(networkEgressHostOf("wss://stream.example.com/socket")).toBe("stream.example.com");
	});

	it("returns empty for chrome-extension / devtools / blob / data / about / file", () => {
		expect(networkEgressHostOf("chrome-extension://canmgnaecmhfjdjkbbfhcmjpahdjcoan/x.js")).toBe("");
		expect(networkEgressHostOf("devtools://devtools/bundled/inspector.html")).toBe("");
		expect(networkEgressHostOf("blob:https://example.com/uuid")).toBe("");
		expect(networkEgressHostOf("data:text/html,hi")).toBe("");
		expect(networkEgressHostOf("about:blank")).toBe("");
		expect(networkEgressHostOf("file:///etc/hosts")).toBe("");
	});

	it("returns empty on malformed URLs (defensive)", () => {
		expect(networkEgressHostOf("not a url")).toBe("");
	});
});

describe("makeFileAuditSink — basic append", () => {
	let dir: string;
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "brainstorm-audit-"));
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("creates the file + writes a single line", async () => {
		const path = join(dir, "audit.jsonl");
		const sink = makeFileAuditSink(path);
		await sink('{"x":1}');
		const text = await readFile(path, "utf8");
		expect(text).toBe('{"x":1}\n');
	});

	it("appends successive writes line-by-line", async () => {
		const path = join(dir, "audit.jsonl");
		const sink = makeFileAuditSink(path);
		await sink("a");
		await sink("b");
		await sink("c");
		const text = await readFile(path, "utf8");
		expect(text).toBe("a\nb\nc\n");
	});

	it("picks up existing on-disk size from a previous session", async () => {
		const path = join(dir, "audit.jsonl");
		// Pre-seed with a session-prior file.
		await writeFile(path, "previous-line\n", "utf8");
		const sink = makeFileAuditSink(path, { rotateBytes: 100 });
		await sink("new-line");
		const text = await readFile(path, "utf8");
		expect(text).toBe("previous-line\nnew-line\n");
	});
});

describe("makeFileAuditSink — rotation", () => {
	let dir: string;
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "brainstorm-audit-"));
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("rotates when the file exceeds `rotateBytes`", async () => {
		const path = join(dir, "audit.jsonl");
		const rotated = rotatedPathFor(path);
		// Tiny cap so each line forces rotation.
		const sink = makeFileAuditSink(path, { rotateBytes: 10 });
		// First write fits (rotation doesn't fire from zero — there's
		// nothing useful to roll yet).
		await sink("hello");
		// Second write would push past 10 bytes: roll the existing
		// "hello\n" to .1 and start fresh with "world".
		await sink("world");
		const current = await readFile(path, "utf8");
		const archived = await readFile(rotated, "utf8");
		expect(current).toBe("world\n");
		expect(archived).toBe("hello\n");
	});

	it("a single rotation overwrites any prior `.1.jsonl`", async () => {
		const path = join(dir, "audit.jsonl");
		const rotated = rotatedPathFor(path);
		await writeFile(rotated, "stale-old-content\n", "utf8");
		const sink = makeFileAuditSink(path, { rotateBytes: 10 });
		await sink("hello");
		await sink("world");
		const archived = await readFile(rotated, "utf8");
		expect(archived).toBe("hello\n");
		// Stale content evicted.
		expect(archived).not.toContain("stale-old-content");
	});

	it("does NOT rotate when total stays under the cap", async () => {
		const path = join(dir, "audit.jsonl");
		const rotated = rotatedPathFor(path);
		const sink = makeFileAuditSink(path, { rotateBytes: 1024 });
		await sink("a");
		await sink("b");
		await sink("c");
		// No rotation file should exist.
		await expect(stat(rotated)).rejects.toThrow();
		const text = await readFile(path, "utf8");
		expect(text).toBe("a\nb\nc\n");
	});

	it("default rotate threshold is 10 MiB (cap is real)", () => {
		expect(DEFAULT_AUDIT_ROTATE_BYTES).toBe(10 * 1024 * 1024);
	});

	it("rotates twice in a row — second rotation overwrites the first's archive", async () => {
		const path = join(dir, "audit.jsonl");
		const rotated = rotatedPathFor(path);
		const sink = makeFileAuditSink(path, { rotateBytes: 10 });
		await sink("first-batch"); // 12 bytes — fits initially
		await sink("second-overflow"); // triggers rotate: first-batch → .1
		const firstArchive = await readFile(rotated, "utf8");
		expect(firstArchive).toBe("first-batch\n");
		await sink("third-overflow"); // triggers another rotate
		const secondArchive = await readFile(rotated, "utf8");
		// `second-overflow\n` is now in `.1.jsonl`; `first-batch\n` is gone.
		expect(secondArchive).toBe("second-overflow\n");
		expect(secondArchive).not.toContain("first-batch");
		const current = await readFile(path, "utf8");
		expect(current).toBe("third-overflow\n");
	});

	it("rotation is silent (no throw) when the line-write itself succeeds", async () => {
		// Best-effort: a rotation that can't happen logs + keeps appending.
		// We can't easily simulate the failure here without permission
		// trickery, so this is a smoke for the happy path.
		const path = join(dir, "audit.jsonl");
		const sink = makeFileAuditSink(path, { rotateBytes: 10 });
		await sink("aaaaa");
		await sink("bbbbb");
		// No throw — the second line either appended-and-grew or rotated.
		expect(true).toBe(true);
	});
});

describe("readAuditRecords — reader for the Net-1f Settings panel", () => {
	let dir: string;
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "brainstorm-audit-read-"));
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("returns [] when the file doesn't exist", async () => {
		const out = await readAuditRecords(join(dir, "nope.jsonl"));
		expect(out).toEqual([]);
	});

	it("returns [] for an empty file", async () => {
		const path = join(dir, "audit.jsonl");
		await writeFile(path, "", "utf8");
		const out = await readAuditRecords(path);
		expect(out).toEqual([]);
	});

	it("parses one record + applies the default-24h window", async () => {
		const path = join(dir, "audit.jsonl");
		const now = 1_700_000_000_000;
		const inside = rec({ ts: now - 1000 });
		await writeFile(path, `${JSON.stringify(inside)}\n`, "utf8");
		const out = await readAuditRecords(path, { now: () => now });
		expect(out).toHaveLength(1);
		expect(out[0]?.ts).toBe(inside.ts);
	});

	it("drops records older than 24 hours by default", async () => {
		const path = join(dir, "audit.jsonl");
		const now = 1_700_000_000_000;
		const stale = rec({ ts: now - DEFAULT_READ_WINDOW_MS - 1 });
		const fresh = rec({ ts: now - 1000 });
		await writeFile(path, `${JSON.stringify(stale)}\n${JSON.stringify(fresh)}\n`, "utf8");
		const out = await readAuditRecords(path, { now: () => now });
		expect(out).toHaveLength(1);
		expect(out[0]?.ts).toBe(fresh.ts);
	});

	it("sorts newest-first", async () => {
		const path = join(dir, "audit.jsonl");
		const now = 1_700_000_000_000;
		const a = rec({ ts: now - 5000, appId: "a" });
		const b = rec({ ts: now - 1000, appId: "b" });
		const c = rec({ ts: now - 3000, appId: "c" });
		await writeFile(
			path,
			`${JSON.stringify(a)}\n${JSON.stringify(b)}\n${JSON.stringify(c)}\n`,
			"utf8",
		);
		const out = await readAuditRecords(path, { now: () => now });
		expect(out.map((r) => r.appId)).toEqual(["b", "c", "a"]);
	});

	it("caps at `limit` after sort", async () => {
		const path = join(dir, "audit.jsonl");
		const now = 1_700_000_000_000;
		const lines: string[] = [];
		for (let i = 0; i < 50; i++) {
			lines.push(JSON.stringify(rec({ ts: now - i * 100, appId: `app${i}` })));
		}
		await writeFile(path, `${lines.join("\n")}\n`, "utf8");
		const out = await readAuditRecords(path, { now: () => now, limit: 5 });
		expect(out).toHaveLength(5);
		expect(out[0]?.appId).toBe("app0");
		expect(out[4]?.appId).toBe("app4");
	});

	it("merges in the rotated archive", async () => {
		const path = join(dir, "audit.jsonl");
		const rotated = rotatedPathFor(path);
		const now = 1_700_000_000_000;
		await writeFile(rotated, `${JSON.stringify(rec({ ts: now - 2000, appId: "old" }))}\n`, "utf8");
		await writeFile(path, `${JSON.stringify(rec({ ts: now - 1000, appId: "new" }))}\n`, "utf8");
		const out = await readAuditRecords(path, { now: () => now });
		expect(out.map((r) => r.appId)).toEqual(["new", "old"]);
	});

	it("skips malformed JSON lines without failing the read", async () => {
		const path = join(dir, "audit.jsonl");
		const now = 1_700_000_000_000;
		const good = rec({ ts: now - 1000 });
		await writeFile(path, `not-json\n${JSON.stringify(good)}\n{half-line`, "utf8");
		const out = await readAuditRecords(path, { now: () => now });
		expect(out).toHaveLength(1);
		expect(out[0]?.ts).toBe(good.ts);
	});

	it("rejects malformed records (missing required fields)", async () => {
		const path = join(dir, "audit.jsonl");
		const now = 1_700_000_000_000;
		const valid = rec({ ts: now - 1000 });
		const invalid = JSON.stringify({ ts: now - 2000, host: "x" }); // missing required keys
		await writeFile(path, `${invalid}\n${JSON.stringify(valid)}\n`, "utf8");
		const out = await readAuditRecords(path, { now: () => now });
		expect(out).toHaveLength(1);
		expect(out[0]?.ts).toBe(valid.ts);
	});

	it("honours an explicit fromMs / toMs window", async () => {
		const path = join(dir, "audit.jsonl");
		const now = 1_700_000_000_000;
		const early = rec({ ts: now - 10_000, appId: "early" });
		const mid = rec({ ts: now - 5_000, appId: "mid" });
		const late = rec({ ts: now - 1_000, appId: "late" });
		await writeFile(
			path,
			`${JSON.stringify(early)}\n${JSON.stringify(mid)}\n${JSON.stringify(late)}\n`,
			"utf8",
		);
		const out = await readAuditRecords(path, {
			now: () => now,
			fromMs: now - 7_000,
			toMs: now - 2_000,
		});
		expect(out.map((r) => r.appId)).toEqual(["mid"]);
	});

	it("default limit is 1000", () => {
		expect(DEFAULT_READ_LIMIT).toBe(1000);
	});

	it("default window is 24 hours", () => {
		expect(DEFAULT_READ_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
	});

	it("inverted window (from > to) returns []", async () => {
		const path = join(dir, "audit.jsonl");
		await writeFile(path, `${JSON.stringify(rec())}\n`, "utf8");
		const out = await readAuditRecords(path, { fromMs: 2, toMs: 1 });
		expect(out).toEqual([]);
	});
});

describe("filterBlockedRecords", () => {
	it("keeps only Refused / Aborted / Errored outcomes", () => {
		const completed = rec({ ts: 1, outcome: NetworkAuditOutcome.Completed });
		const refused = rec({ ts: 2, outcome: NetworkAuditOutcome.Refused, reason: "ssrf-private-ip" });
		const aborted = rec({ ts: 3, outcome: NetworkAuditOutcome.Aborted, reason: "size-cap" });
		const errored = rec({ ts: 4, outcome: NetworkAuditOutcome.Errored, reason: "dns-failed" });
		const out = filterBlockedRecords([completed, refused, aborted, errored]);
		expect(out.map((r) => r.outcome)).toEqual([
			NetworkAuditOutcome.Refused,
			NetworkAuditOutcome.Aborted,
			NetworkAuditOutcome.Errored,
		]);
	});

	it("returns [] when every record is Completed", () => {
		expect(filterBlockedRecords([rec(), rec({ ts: 2 })])).toEqual([]);
	});
});

describe("summarizePerApp", () => {
	it("returns one row per app with byte totals + last-seen", () => {
		const out = summarizePerApp([
			rec({ appId: "a", ts: 100, bytes: 10, host: "h1.com" }),
			rec({ appId: "a", ts: 200, bytes: 20, host: "h2.com" }),
			rec({ appId: "b", ts: 50, bytes: 5, host: "h3.com" }),
		]);
		expect(out).toHaveLength(2);
		const a = out.find((r) => r.appId === "a");
		const b = out.find((r) => r.appId === "b");
		expect(a?.receivedBytes).toBe(30);
		expect(a?.requestCount).toBe(2);
		expect(a?.lastSeenMs).toBe(200);
		expect(b?.receivedBytes).toBe(5);
	});

	it("sorts rows newest-last-seen first", () => {
		const out = summarizePerApp([
			rec({ appId: "old", ts: 100 }),
			rec({ appId: "new", ts: 500 }),
			rec({ appId: "mid", ts: 250 }),
		]);
		expect(out.map((r) => r.appId)).toEqual(["new", "mid", "old"]);
	});

	it("emits top-N hosts per app, ranked by count desc then host name", () => {
		const out = summarizePerApp(
			[
				rec({ appId: "a", host: "alpha.com" }),
				rec({ appId: "a", host: "alpha.com" }),
				rec({ appId: "a", host: "beta.com" }),
				rec({ appId: "a", host: "beta.com" }),
				rec({ appId: "a", host: "gamma.com" }),
			],
			{ topHostsPerApp: 2 },
		);
		const a = out[0];
		expect(a?.topHosts).toEqual([
			{ host: "alpha.com", count: 2 },
			{ host: "beta.com", count: 2 },
		]);
	});

	it("default top-host cap is 10 per app", () => {
		expect(DEFAULT_TOP_HOSTS_PER_APP).toBe(10);
	});

	it("returns [] for an empty record list", () => {
		expect(summarizePerApp([])).toEqual([]);
	});

	it("skips empty-host records for the top-hosts list (logged but not bucketed)", () => {
		const out = summarizePerApp([rec({ host: "" })]);
		expect(out).toHaveLength(1);
		expect(out[0]?.topHosts).toEqual([]);
		// `requestCount` still counts the row — the audit row exists, just
		// no host to attribute.
		expect(out[0]?.requestCount).toBe(1);
	});
});
