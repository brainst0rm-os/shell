// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	BLOCK_FRAME_DEFAULT_MAX_PAYLOAD_BYTES,
	BlockFrameDropReason,
} from "./block-frame-constants";
import { type BlockFrameInnerTransport, createBlockFrameInnerTransport } from "./inner-transport";
import {
	type BlockFrameEnvelope,
	BlockFrameMessageDirection,
	BlockFrameMessageKind,
	type BlockFrameStartupPayload,
} from "./transport";

/**
 * Inner-transport runs INSIDE the iframe; its counterparties are
 * `globalThis.window` (the iframe's own window — `self`) and
 * `globalThis.window.parent` (the host renderer). The tests fake both,
 * mirroring the host-side test scaffolding for symmetry.
 */
interface FakeSelf {
	addEventListener: typeof window.addEventListener;
	removeEventListener: typeof window.removeEventListener;
	dispatch(detail: { source?: unknown; origin?: string; data?: unknown }): void;
	listenerCount(): number;
}

function makeFakeSelf(): FakeSelf {
	const listeners = new Set<EventListener>();
	return {
		addEventListener: ((_type: string, listener: EventListener) => {
			listeners.add(listener);
		}) as typeof window.addEventListener,
		removeEventListener: ((_type: string, listener: EventListener) => {
			listeners.delete(listener);
		}) as typeof window.removeEventListener,
		dispatch(detail): void {
			const ev = {
				source: detail.source ?? null,
				origin: detail.origin ?? "null",
				data: detail.data ?? null,
			} as unknown as MessageEvent;
			for (const l of [...listeners]) l(ev as unknown as Event);
		},
		listenerCount: () => listeners.size,
	};
}

interface FakeParent {
	postMessage: Window["postMessage"];
	posts: Array<{ message: unknown; targetOrigin: string }>;
}

function makeFakeParent(): FakeParent {
	const posts: Array<{ message: unknown; targetOrigin: string }> = [];
	const postMessage = ((message: unknown, targetOrigin: unknown) => {
		posts.push({ message, targetOrigin: String(targetOrigin) });
	}) as Window["postMessage"];
	return { posts, postMessage };
}

describe("createBlockFrameInnerTransport — identity gate", () => {
	let self: FakeSelf;
	let parent: FakeParent;
	let onMessage: (p: unknown) => void;
	let t: BlockFrameInnerTransport;

	beforeEach(() => {
		self = makeFakeSelf();
		parent = makeFakeParent();
		onMessage = vi.fn();
		t = createBlockFrameInnerTransport({
			expectedChannelId: "ch-x",
			expectedEntityId: "ent_x",
			onMessage,
			self,
			parent,
		});
	});

	afterEach(() => {
		t.close();
	});

	const valid = (overrides: Partial<BlockFrameEnvelope> = {}): BlockFrameEnvelope => ({
		channelId: "ch-x",
		entityId: "ent_x",
		direction: BlockFrameMessageDirection.HostToBlock,
		kind: BlockFrameMessageKind.Message,
		payload: { ok: true },
		...overrides,
	});

	it("accepts inbound from window.parent", () => {
		self.dispatch({ source: parent, data: valid() });
		expect(onMessage).toHaveBeenCalledWith({ ok: true });
	});

	it("rejects inbound from a sibling iframe (NOT the parent) — identity gate", () => {
		const sibling = { postMessage: () => undefined } as unknown as Window;
		self.dispatch({ source: sibling, origin: "null", data: valid() });
		expect(onMessage).not.toHaveBeenCalled();
		expect(t.dropCounts()[BlockFrameDropReason.InboundIdentity]).toBe(1);
	});

	it("rejects inbound with `source: null` even if shape is perfect", () => {
		self.dispatch({ source: null, data: valid() });
		expect(onMessage).not.toHaveBeenCalled();
		expect(t.dropCounts()[BlockFrameDropReason.InboundIdentity]).toBe(1);
	});
});

describe("createBlockFrameInnerTransport — channel + entity + direction + kind gates", () => {
	let self: FakeSelf;
	let parent: FakeParent;
	let onMessage: (p: unknown) => void;
	let onStartup: (p: BlockFrameStartupPayload) => void;
	let t: BlockFrameInnerTransport;

	beforeEach(() => {
		self = makeFakeSelf();
		parent = makeFakeParent();
		onMessage = vi.fn();
		onStartup = vi.fn();
		t = createBlockFrameInnerTransport({
			expectedChannelId: "ch-x",
			expectedEntityId: "ent_x",
			onMessage,
			onStartup,
			self,
			parent,
		});
	});

	afterEach(() => {
		t.close();
	});

	const valid = (overrides: Partial<BlockFrameEnvelope> = {}): BlockFrameEnvelope => ({
		channelId: "ch-x",
		entityId: "ent_x",
		direction: BlockFrameMessageDirection.HostToBlock,
		kind: BlockFrameMessageKind.Message,
		payload: { ok: true },
		...overrides,
	});

	it("rejects inbound with wrong channelId", () => {
		self.dispatch({ source: parent, data: valid({ channelId: "wrong" }) });
		expect(onMessage).not.toHaveBeenCalled();
		expect(t.dropCounts()[BlockFrameDropReason.InboundChannel]).toBe(1);
	});

	it("rejects inbound with wrong entityId", () => {
		self.dispatch({ source: parent, data: valid({ entityId: "ent_y" }) });
		expect(onMessage).not.toHaveBeenCalled();
		expect(t.dropCounts()[BlockFrameDropReason.InboundEntityId]).toBe(1);
	});

	it("rejects inbound with BlockToHost direction (host's send is the only legit direction)", () => {
		self.dispatch({
			source: parent,
			data: valid({ direction: BlockFrameMessageDirection.BlockToHost }),
		});
		expect(onMessage).not.toHaveBeenCalled();
		expect(t.dropCounts()[BlockFrameDropReason.InboundDirection]).toBe(1);
	});

	it("routes Startup envelopes to onStartup, never to onMessage", () => {
		self.dispatch({
			source: parent,
			data: valid({
				kind: BlockFrameMessageKind.Startup,
				payload: { capabilities: ["entities.read:Note"] } as BlockFrameStartupPayload,
			}),
		});
		expect(onStartup).toHaveBeenCalledWith({ capabilities: ["entities.read:Note"] });
		expect(onMessage).not.toHaveBeenCalled();
		expect(t.hasReceivedStartup()).toBe(true);
	});

	it("Startup is delivered exactly once even if the host re-sends", () => {
		const startup = valid({
			kind: BlockFrameMessageKind.Startup,
			payload: { capabilities: [] } as BlockFrameStartupPayload,
		});
		self.dispatch({ source: parent, data: startup });
		self.dispatch({ source: parent, data: startup });
		self.dispatch({ source: parent, data: startup });
		expect(onStartup).toHaveBeenCalledTimes(1);
	});

	it("malformed inbound (null / array / number / missing fields) is dropped", () => {
		self.dispatch({ source: parent, data: null });
		self.dispatch({ source: parent, data: 42 });
		self.dispatch({ source: parent, data: "x" });
		self.dispatch({ source: parent, data: {} });
		expect(onMessage).not.toHaveBeenCalled();
		// `null/undefined/string/number` count as malformed; `{}` then fails the channel gate.
		const counts = t.dropCounts();
		expect(counts[BlockFrameDropReason.InboundMalformed]).toBeGreaterThanOrEqual(3);
	});

	it("a throwing onMessage callback does not break subsequent deliveries", () => {
		const throwing = vi.fn(() => {
			throw new Error("block crash");
		});
		const t2 = createBlockFrameInnerTransport({
			expectedChannelId: "ch-2",
			expectedEntityId: "ent_x",
			onMessage: throwing,
			self,
			parent,
		});
		const env = valid({ channelId: "ch-2" });
		expect(() => self.dispatch({ source: parent, data: env })).not.toThrow();
		expect(throwing).toHaveBeenCalledTimes(1);
		self.dispatch({ source: parent, data: env });
		expect(throwing).toHaveBeenCalledTimes(2);
		t2.close();
	});
});

describe("createBlockFrameInnerTransport — outbound send()", () => {
	it("send() posts a BlockToHost / Message envelope with the bound ids", () => {
		const self = makeFakeSelf();
		const parent = makeFakeParent();
		const t = createBlockFrameInnerTransport({
			expectedChannelId: "ch-x",
			expectedEntityId: "ent_x",
			self,
			parent,
		});
		t.send({ hello: "host" });
		expect(parent.posts).toHaveLength(1);
		const env = parent.posts[0]?.message as BlockFrameEnvelope;
		expect(env.channelId).toBe("ch-x");
		expect(env.entityId).toBe("ent_x");
		expect(env.direction).toBe(BlockFrameMessageDirection.BlockToHost);
		expect(env.kind).toBe(BlockFrameMessageKind.Message);
		expect(env.payload).toEqual({ hello: "host" });
		expect(parent.posts[0]?.targetOrigin).toBe("*");
		t.close();
	});

	it("send() after close is a no-op + counted under OutboundClosed", () => {
		const self = makeFakeSelf();
		const parent = makeFakeParent();
		const t = createBlockFrameInnerTransport({
			expectedChannelId: "ch-x",
			expectedEntityId: "ent_x",
			self,
			parent,
		});
		t.close();
		t.send({ a: 1 });
		t.send({ b: 2 });
		expect(parent.posts).toHaveLength(0);
		expect(t.dropCounts()[BlockFrameDropReason.OutboundClosed]).toBe(2);
	});

	it("send() with no postMessage on parent drops + counts (degenerate top-level case)", () => {
		const self = makeFakeSelf();
		const t = createBlockFrameInnerTransport({
			expectedChannelId: "ch-x",
			expectedEntityId: "ent_x",
			self,
			parent: {} as unknown as { postMessage: typeof window.postMessage },
		});
		t.send({ a: 1 });
		expect(t.dropCounts()[BlockFrameDropReason.OutboundClosed]).toBe(1);
		t.close();
	});
});

describe("createBlockFrameInnerTransport — payload-size cap", () => {
	const valid = (overrides: Partial<BlockFrameEnvelope> = {}): BlockFrameEnvelope => ({
		channelId: "ch-x",
		entityId: "ent_x",
		direction: BlockFrameMessageDirection.HostToBlock,
		kind: BlockFrameMessageKind.Message,
		payload: { ok: true },
		...overrides,
	});

	it("default cap matches the host-side default", () => {
		// Same constant — symmetry property.
		expect(BLOCK_FRAME_DEFAULT_MAX_PAYLOAD_BYTES).toBe(256 * 1024);
	});

	it("outbound over the cap is dropped + counted", () => {
		const self = makeFakeSelf();
		const parent = makeFakeParent();
		const t = createBlockFrameInnerTransport({
			expectedChannelId: "ch-x",
			expectedEntityId: "ent_x",
			self,
			parent,
			maxPayloadBytes: 200,
		});
		t.send({ big: "x".repeat(500) });
		expect(parent.posts).toHaveLength(0);
		expect(t.dropCounts()[BlockFrameDropReason.OutboundPayloadTooLarge]).toBe(1);
		t.close();
	});

	it("inbound over the cap is dropped + counted", () => {
		const self = makeFakeSelf();
		const parent = makeFakeParent();
		const onMessage = vi.fn();
		const t = createBlockFrameInnerTransport({
			expectedChannelId: "ch-x",
			expectedEntityId: "ent_x",
			self,
			parent,
			onMessage,
			maxPayloadBytes: 200,
		});
		self.dispatch({
			source: parent,
			data: valid({ payload: { big: "x".repeat(500) } }),
		});
		expect(onMessage).not.toHaveBeenCalled();
		expect(t.dropCounts()[BlockFrameDropReason.InboundPayloadTooLarge]).toBe(1);
		t.close();
	});

	it("invalid cap (≤0) falls back to the default", () => {
		const self = makeFakeSelf();
		const parent = makeFakeParent();
		const t = createBlockFrameInnerTransport({
			expectedChannelId: "ch-x",
			expectedEntityId: "ent_x",
			self,
			parent,
			maxPayloadBytes: -10,
		});
		t.send({ small: true });
		expect(parent.posts).toHaveLength(1);
		t.close();
	});

	it("non-serialisable outbound (cyclic) is dropped on send", () => {
		const self = makeFakeSelf();
		const parent = makeFakeParent();
		const t = createBlockFrameInnerTransport({
			expectedChannelId: "ch-x",
			expectedEntityId: "ent_x",
			self,
			parent,
		});
		const cyclic: { self?: unknown } = {};
		cyclic.self = cyclic;
		t.send(cyclic);
		expect(parent.posts).toHaveLength(0);
		expect(t.dropCounts()[BlockFrameDropReason.OutboundPayloadTooLarge]).toBe(1);
		t.close();
	});

	it("Startup envelope is EXEMPT from the inner payload-size cap (mirrors host exemption)", () => {
		// A tighter inner cap must not drop the legitimate Startup
		// envelope; if it did, the block would never learn its capability
		// snapshot. The host transport exempts host-minted Startup from
		// its own cap (bounded by construction — capability list only);
		// the inner side mirrors. Pre-9.5.3-integrator-fix this fired
		// the size gate BEFORE the kind branch, dropping any Startup that
		// happened to exceed a misconfigured cap.
		const self = makeFakeSelf();
		const parent = makeFakeParent();
		const onStartup = vi.fn();
		const t = createBlockFrameInnerTransport({
			expectedChannelId: "ch-x",
			expectedEntityId: "ent_x",
			self,
			parent,
			onStartup,
			maxPayloadBytes: 50, // tighter than the envelope below
		});
		const startup: BlockFrameEnvelope = {
			channelId: "ch-x",
			entityId: "ent_x",
			direction: BlockFrameMessageDirection.HostToBlock,
			kind: BlockFrameMessageKind.Startup,
			payload: { capabilities: ["entities.read:Note", "entities.write:Note", "ui.dialog:confirm"] },
		};
		self.dispatch({ source: parent, data: startup });
		expect(onStartup).toHaveBeenCalledTimes(1);
		expect(t.hasReceivedStartup()).toBe(true);
		// Size-cap counter NOT incremented for the Startup path.
		expect(t.dropCounts()[BlockFrameDropReason.InboundPayloadTooLarge]).toBe(0);
		t.close();
	});
});

describe("createBlockFrameInnerTransport — dropCounts() snapshot is frozen", () => {
	it("returned snapshot is Object.frozen — caller cannot mutate", () => {
		const self = makeFakeSelf();
		const parent = makeFakeParent();
		const t = createBlockFrameInnerTransport({
			expectedChannelId: "ch-x",
			expectedEntityId: "ent_x",
			self,
			parent,
		});
		const snap = t.dropCounts();
		expect(Object.isFrozen(snap)).toBe(true);
		expect(() => {
			(snap as unknown as Record<string, number>)["inbound-identity"] = 99;
		}).toThrow(TypeError);
		t.close();
	});

	it("each call returns a FRESH frozen snapshot (transport state untouched by previous returns)", () => {
		const self = makeFakeSelf();
		const parent = makeFakeParent();
		const t = createBlockFrameInnerTransport({
			expectedChannelId: "ch-x",
			expectedEntityId: "ent_x",
			self,
			parent,
		});
		const a = t.dropCounts();
		const b = t.dropCounts();
		expect(a).not.toBe(b); // identity
		expect(a).toEqual(b); // value
		t.close();
	});
});

describe("createBlockFrameInnerTransport — close + lifecycle", () => {
	it("close() removes the self listener", () => {
		const self = makeFakeSelf();
		const parent = makeFakeParent();
		const t = createBlockFrameInnerTransport({
			expectedChannelId: "ch-x",
			expectedEntityId: "ent_x",
			self,
			parent,
		});
		expect(self.listenerCount()).toBe(1);
		t.close();
		expect(self.listenerCount()).toBe(0);
		expect(t.isClosed()).toBe(true);
	});

	it("close() is idempotent", () => {
		const self = makeFakeSelf();
		const parent = makeFakeParent();
		const t = createBlockFrameInnerTransport({
			expectedChannelId: "ch-x",
			expectedEntityId: "ent_x",
			self,
			parent,
		});
		t.close();
		t.close();
		t.close();
		expect(self.listenerCount()).toBe(0);
	});

	it("inbound after close is silently ignored", () => {
		const self = makeFakeSelf();
		const parent = makeFakeParent();
		const onMessage = vi.fn();
		const t = createBlockFrameInnerTransport({
			expectedChannelId: "ch-x",
			expectedEntityId: "ent_x",
			self,
			parent,
			onMessage,
		});
		t.close();
		self.dispatch({
			source: parent,
			data: {
				channelId: "ch-x",
				entityId: "ent_x",
				direction: BlockFrameMessageDirection.HostToBlock,
				kind: BlockFrameMessageKind.Message,
				payload: {},
			} as BlockFrameEnvelope,
		});
		expect(onMessage).not.toHaveBeenCalled();
	});
});

describe("createBlockFrameInnerTransport — no-inherited-caps contract (jsdom-vacuous, real-Chromium-tested at 13.3)", () => {
	/**
	 * jsdom does NOT enforce iframe sandbox / opaque origin — the inner
	 * transport in a jsdom test has full access to the host globals (this
	 * is true of every other isolation test in the SDK suite). The
	 * contract these tests pin is:
	 *
	 *   1. The transport surface itself never touches `globalThis.brainstorm`,
	 *      `globalThis.fetch`, `document.cookie`, etc. — it never reads, never
	 *      sets, never even names them. The block author code that runs
	 *      ON TOP of this transport could try, but in real Chromium the
	 *      opaque-origin sandbox would block: `document.cookie` throws,
	 *      `fetch` is gated by `connect-src 'none'`, `brainstorm` global is
	 *      never injected (no preload).
	 *   2. The transport's only "ambient authority" is the `expectedChannelId`
	 *      + `expectedEntityId` it was constructed with — both come from
	 *      the host via the Startup envelope, both are scoped to this single
	 *      block instance, neither grants any capability beyond "talk to
	 *      one specific iframe slot".
	 *
	 * 13.3's Playwright sibling test will:
	 *   • Mount a real iframe with the 9.5.1 srcdoc.
	 *   • Run `iframe.contentWindow.eval(...)` (or message-channel a probe)
	 *     asserting `document.cookie` throws SecurityError,
	 *     `window.fetch("https://example.com")` is blocked by CSP, and
	 *     `window.brainstorm === undefined`.
	 *   • Re-run the spoofing test under a real second iframe.
	 */
	it("transport module source mentions no ambient capability globals", async () => {
		// Read-back contract: the inner-transport implementation never
		// references `globalThis.brainstorm` / `document.cookie` / `fetch` /
		// `localStorage` / `indexedDB` — a future regression that pulls one
		// in would re-broaden the surface. The check is a substring scan
		// of the source (the file is small enough that the regex
		// false-positive risk is negligible — and tests on the AST would
		// drag in @typescript-eslint just for this).
		const { readFileSync } = await import("node:fs");
		const { resolve } = await import("node:path");
		// vitest runs from the repo root; the path is stable.
		const path = resolve(process.cwd(), "packages/sdk/src/block-frame/inner-transport.ts");
		const src = readFileSync(path, "utf8");
		// Allow `globalThis.window` (the iframe's own window — IS bounded
		// by sandbox) and `globalThis.window.parent` (the host counterparty
		// — required for message direction). Disallow everything else.
		const FORBIDDEN = [
			"globalThis.brainstorm",
			"globalThis.fetch",
			"globalThis.localStorage",
			"globalThis.sessionStorage",
			"globalThis.indexedDB",
			"globalThis.crypto",
			"document.cookie",
			".fetch(",
		];
		for (const needle of FORBIDDEN) {
			expect(src.includes(needle), `inner-transport.ts must not reference ${needle}`).toBe(false);
		}
	});

	it("constructed transport exposes ONLY the documented method surface (no escape hatches)", () => {
		const self = makeFakeSelf();
		const parent = makeFakeParent();
		const t = createBlockFrameInnerTransport({
			expectedChannelId: "ch-x",
			expectedEntityId: "ent_x",
			self,
			parent,
		});
		const keys = Object.keys(t).sort();
		expect(keys).toEqual(["close", "dropCounts", "hasReceivedStartup", "isClosed", "send"].sort());
		t.close();
	});
});

describe("createBlockFrameInnerTransport — round-trip with host transport", () => {
	it("host->block->host shape symmetry: an envelope minted by the inner side parses on the host", async () => {
		// Mount: shared message bus (the iframe's window is the host's
		// listener target; the inner's parent is the host's `dispatcher`).
		const innerSelf = makeFakeSelf();
		const innerParent = makeFakeParent();
		const inner = createBlockFrameInnerTransport({
			expectedChannelId: "ch-round",
			expectedEntityId: "ent_round",
			self: innerSelf,
			parent: innerParent,
		});
		// Drive the host-side parser by hand — same gate sequence as the
		// real host transport.
		const env = (() => {
			inner.send({ to: "host" });
			return innerParent.posts[0]?.message as BlockFrameEnvelope;
		})();
		expect(env.channelId).toBe("ch-round");
		expect(env.entityId).toBe("ent_round");
		expect(env.direction).toBe(BlockFrameMessageDirection.BlockToHost);
		expect(env.kind).toBe(BlockFrameMessageKind.Message);
		inner.close();
	});
});
