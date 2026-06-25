/**
 * Stage 10.4 — `FrameRouter` unit tests.
 *
 * Drives the pure routing logic through fixture frames built with the
 * duplicated wire encoder. The audit log is observed via `entries()` so
 * each test pins the on-wire-observable shape AND the relay's
 * audit-side surface in one pass.
 *
 * Fixture-building intentionally does NOT use the shell's
 * `envelope-codec.ts` — the relay-server is meant to be deployable
 * without the shell package, and the test fixture mirrors what a real
 * client would put on the wire.
 */

import { describe, expect, it } from "vitest";
import { AuditLog } from "./audit-log";
import { FrameRouter } from "./router";
import { PROTOCOL_VERSION, type RoutingHeader, WireKind } from "./wire";

function encodeFrame(opts: {
	header: RoutingHeader;
	sig?: Uint8Array;
	ciphertext?: Uint8Array;
}): Uint8Array {
	const sig = opts.sig ?? new Uint8Array(64);
	const ciphertext = opts.ciphertext ?? new Uint8Array([0xaa, 0xbb, 0xcc]);
	const headerJson = JSON.stringify({
		v: opts.header.v,
		kind: opts.header.kind,
		entityId: opts.header.entityId,
		sender: opts.header.sender,
		seq: opts.header.seq,
		nonce: opts.header.nonce,
		ts: opts.header.ts,
		...(opts.header.route ? { route: opts.header.route } : {}),
	});
	const headerBytes = new TextEncoder().encode(headerJson);
	const out = new Uint8Array(4 + headerBytes.length + 2 + sig.length + 4 + ciphertext.length);
	const view = new DataView(out.buffer);
	let off = 0;
	view.setUint32(off, headerBytes.length, false);
	off += 4;
	out.set(headerBytes, off);
	off += headerBytes.length;
	view.setUint16(off, sig.length, false);
	off += 2;
	out.set(sig, off);
	off += sig.length;
	view.setUint32(off, ciphertext.length, false);
	off += 4;
	out.set(ciphertext, off);
	return out;
}

function makeHeader(overrides: Partial<RoutingHeader> = {}): RoutingHeader {
	return {
		v: PROTOCOL_VERSION,
		kind: WireKind.Update,
		entityId: "ent_1",
		sender: "sender-1",
		seq: 1,
		nonce: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
		ts: 1_700_000_000_000,
		...overrides,
	};
}

describe("FrameRouter — basic fan-out", () => {
	it("subscribe + send fans out to other subscribers, never echoes to sender", () => {
		const audit = new AuditLog({ now: () => 42 });
		const router = new FrameRouter(audit);
		router.subscribe("connA", "ent_1");
		router.subscribe("connB", "ent_1");
		router.subscribe("connC", "ent_1");
		const delivered = new Map<string, Uint8Array[]>();
		const send = (toConnId: string, frame: Uint8Array): void => {
			let list = delivered.get(toConnId);
			if (!list) {
				list = [];
				delivered.set(toConnId, list);
			}
			list.push(frame);
		};
		const frame = encodeFrame({ header: makeHeader() });
		const result = router.route("connA", frame, send);
		expect(result.delivered).toBe(2);
		expect(delivered.get("connA")).toBeUndefined(); // no echo to sender
		expect(delivered.get("connB")?.length).toBe(1);
		expect(delivered.get("connC")?.length).toBe(1);
	});

	it("Collab-C5 — a frame with `route` fans out by the route (inbox), not entityId", () => {
		const audit = new AuditLog({ now: () => 7 });
		const router = new FrameRouter(audit);
		// connB is subscribed to the INBOX route; connC only to the entity channel.
		router.subscribe("connB", "inbox:bob");
		router.subscribe("connC", "ent_secret");
		const delivered = new Map<string, number>();
		const send = (toConnId: string): void => {
			delivered.set(toConnId, (delivered.get(toConnId) ?? 0) + 1);
		};
		// Owner emits a wrap routed to bob's inbox; entityId stays the real entity.
		const frame = encodeFrame({
			header: makeHeader({ kind: WireKind.WrapBootstrap, entityId: "ent_secret", route: "inbox:bob" }),
		});
		const result = router.route("connA", frame, send);
		expect(result.delivered).toBe(1);
		expect(delivered.get("connB")).toBe(1); // reached via the inbox route
		expect(delivered.get("connC")).toBeUndefined(); // NOT via the entity channel
		// The audit still records the real entity, not the routing label.
		expect(audit.entries().at(-1)?.entityId).toBe("ent_secret");
	});

	it("unsubscribed connection does not receive frames for that entity", () => {
		const audit = new AuditLog();
		const router = new FrameRouter(audit);
		router.subscribe("connA", "ent_1");
		router.subscribe("connB", "ent_1");
		router.unsubscribe("connB", "ent_1");
		const delivered = new Map<string, Uint8Array[]>();
		router.route("connA", encodeFrame({ header: makeHeader() }), (toConnId, frame) => {
			let list = delivered.get(toConnId);
			if (!list) {
				list = [];
				delivered.set(toConnId, list);
			}
			list.push(frame);
		});
		expect(delivered.get("connB")).toBeUndefined();
	});

	it("no subscribers for the entity → no-op", () => {
		const audit = new AuditLog();
		const router = new FrameRouter(audit);
		router.subscribe("connA", "ent_1");
		const calls: string[] = [];
		const result = router.route(
			"connA",
			encodeFrame({ header: makeHeader({ entityId: "ent_2" }) }),
			(toConnId) => {
				calls.push(toConnId);
			},
		);
		expect(result.delivered).toBe(0);
		expect(calls).toEqual([]);
	});

	it("malformed header drops the frame + bumps counter, never crashes", () => {
		const audit = new AuditLog();
		const router = new FrameRouter(audit);
		router.subscribe("connA", "ent_1");
		router.subscribe("connB", "ent_1");
		const calls: string[] = [];
		// Frame with header len > buffer = truncated
		const bogus = new Uint8Array([0, 0, 0xff, 0xff, 0, 0, 0]);
		const result = router.route("connA", bogus, (toConnId) => {
			calls.push(toConnId);
		});
		expect(result.delivered).toBe(0);
		expect(result.dropped).toBe(1);
		expect(router.malformedDropped()).toBe(1);
		expect(calls).toEqual([]);
	});

	it("dropConnection removes all subscriptions for the connection", () => {
		const audit = new AuditLog();
		const router = new FrameRouter(audit);
		router.subscribe("connA", "ent_1");
		router.subscribe("connA", "ent_2");
		router.subscribe("connB", "ent_1");
		router.dropConnection("connA");
		expect(router.subscriberCount("ent_1")).toBe(1); // only connB
		expect(router.subscriberCount("ent_2")).toBe(0);
		expect(router.connectionEntities("connA")).toEqual([]);
		expect(router.connectionEntities("connB")).toEqual(["ent_1"]);
	});

	it("multi-subscriber: 5 subscribers all receive one copy", () => {
		const audit = new AuditLog();
		const router = new FrameRouter(audit);
		for (let i = 0; i < 5; i++) router.subscribe(`conn${i}`, "ent_1");
		const delivered = new Map<string, number>();
		router.route("conn0", encodeFrame({ header: makeHeader() }), (toConnId) => {
			delivered.set(toConnId, (delivered.get(toConnId) ?? 0) + 1);
		});
		expect(delivered.get("conn0")).toBeUndefined();
		for (let i = 1; i < 5; i++) {
			expect(delivered.get(`conn${i}`)).toBe(1);
		}
	});

	it("send-callback exception does not block siblings", () => {
		const audit = new AuditLog();
		const router = new FrameRouter(audit);
		router.subscribe("connA", "ent_1");
		router.subscribe("connB", "ent_1");
		router.subscribe("connC", "ent_1");
		const delivered = new Map<string, number>();
		router.route("connA", encodeFrame({ header: makeHeader() }), (toConnId) => {
			if (toConnId === "connB") throw new Error("write failed");
			delivered.set(toConnId, (delivered.get(toConnId) ?? 0) + 1);
		});
		expect(delivered.get("connB")).toBeUndefined();
		expect(delivered.get("connC")).toBe(1);
	});
});

describe("FrameRouter — audit-log shape", () => {
	it("appends one audit entry per delivery; carries entityId+kind+bytes; never the payload", () => {
		const audit = new AuditLog({ now: () => 1234 });
		const router = new FrameRouter(audit);
		router.subscribe("connA", "ent_1");
		router.subscribe("connB", "ent_1");
		router.subscribe("connC", "ent_1");
		const frame = encodeFrame({
			header: makeHeader(),
			ciphertext: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
		});
		router.route("connA", frame, () => {});
		const entries = audit.entries();
		expect(entries.length).toBe(2);
		for (const e of entries) {
			expect(e.fromConnId).toBe("connA");
			expect(e.entityId).toBe("ent_1");
			expect(e.kind).toBe(WireKind.Update);
			expect(e.bytes).toBe(frame.length);
			expect(e.ts).toBe(1234);
		}
		// Structural pin: AuditEntry must NOT carry any payload-shaped field.
		const keys = Object.keys(entries[0] ?? {}).sort();
		expect(keys).toEqual(["bytes", "entityId", "fromConnId", "kind", "toConnId", "ts"]);
	});

	it("malformed frame produces no audit entries", () => {
		const audit = new AuditLog();
		const router = new FrameRouter(audit);
		router.subscribe("connA", "ent_1");
		router.subscribe("connB", "ent_1");
		const bogus = new Uint8Array(3);
		router.route("connA", bogus, () => {});
		expect(audit.entries().length).toBe(0);
	});

	it("audit log JSONL output: each entry serialised on its own line; payload bytes absent", () => {
		const audit = new AuditLog({ now: () => 99 });
		const router = new FrameRouter(audit);
		router.subscribe("connA", "ent_1");
		router.subscribe("connB", "ent_1");
		router.route("connA", encodeFrame({ header: makeHeader() }), () => {});
		const jsonl = audit.toJSONL();
		expect(jsonl.split("\n").length).toBe(1);
		expect(jsonl).not.toMatch(/payload/);
		expect(jsonl).not.toMatch(/ciphertext/);
	});
});
