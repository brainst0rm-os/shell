import { describe, expect, it } from "vitest";
import {
	MAX_TRANSCLUSION_DEPTH,
	TransclusionPlacement,
	TransclusionRejectReason,
	TransclusionRenderDecision,
	decideTransclusionRender,
	detectTransclusionTrigger,
	resolveTransclusionPlacement,
	resolveTransclusionTarget,
} from "./transclusion-ops";

describe("resolveTransclusionPlacement (B11.1)", () => {
	it("start-of-block → block, mid-line → inline", () => {
		expect(resolveTransclusionPlacement(true)).toBe(TransclusionPlacement.Block);
		expect(resolveTransclusionPlacement(false)).toBe(TransclusionPlacement.Inline);
	});
});

describe("detectTransclusionTrigger", () => {
	it("triggers at start of text", () => {
		expect(detectTransclusionTrigger("!@spec", 6)).toEqual({ triggerOffset: 0, query: "spec" });
	});

	it("triggers after whitespace, offset points at the `!`", () => {
		// "see !@arch"  → `!` at index 4
		expect(detectTransclusionTrigger("see !@arch", 10)).toEqual({
			triggerOffset: 4,
			query: "arch",
		});
	});

	it("triggers right after the `!@` with an empty query", () => {
		expect(detectTransclusionTrigger("!@", 2)).toEqual({ triggerOffset: 0, query: "" });
	});

	it("triggers after a newline (start-of-line)", () => {
		expect(detectTransclusionTrigger("line1\n!@q", 9)).toEqual({ triggerOffset: 6, query: "q" });
	});

	it("does NOT trigger inside a word", () => {
		expect(detectTransclusionTrigger("note!@x", 7)).toBeNull();
	});

	it("does NOT trigger after punctuation (stricter than mentions)", () => {
		expect(detectTransclusionTrigger("(!@x", 4)).toBeNull();
		expect(detectTransclusionTrigger("a@b!@c", 6)).toBeNull();
	});

	it("does NOT trigger for a bare `@` with no preceding `!`", () => {
		expect(detectTransclusionTrigger(" @x", 3)).toBeNull();
	});

	it("breaks the context on whitespace / newline in the query", () => {
		expect(detectTransclusionTrigger("!@foo bar", 9)).toBeNull();
		expect(detectTransclusionTrigger("!@foo\nbar", 9)).toBeNull();
	});

	it("rejects an over-long query and out-of-range carets", () => {
		expect(detectTransclusionTrigger(`!@${"x".repeat(65)}`, 67)).toBeNull();
		expect(detectTransclusionTrigger("!@x", -1)).toBeNull();
		expect(detectTransclusionTrigger("!@x", 99)).toBeNull();
	});

	it("picks the trigger the caret is inside when several exist", () => {
		// caret at end of "second"
		const text = "@first !@second";
		expect(detectTransclusionTrigger(text, text.length)).toEqual({
			triggerOffset: 7,
			query: "second",
		});
	});
});

describe("resolveTransclusionTarget", () => {
	const noChildren = () => [] as const;

	it("rejects self-embed", () => {
		expect(resolveTransclusionTarget("n1", "n1", noChildren)).toEqual({
			ok: false,
			reason: TransclusionRejectReason.Self,
		});
	});

	it("allows a leaf target", () => {
		expect(resolveTransclusionTarget("host", "t", noChildren)).toEqual({ ok: true });
	});

	it("rejects a direct cycle (target embeds the host)", () => {
		const graph: Record<string, string[]> = { t: ["host"] };
		expect(resolveTransclusionTarget("host", "t", (id) => graph[id] ?? [])).toEqual({
			ok: false,
			reason: TransclusionRejectReason.Cycle,
		});
	});

	it("rejects a transitive cycle (target → a → host)", () => {
		const graph: Record<string, string[]> = { t: ["a"], a: ["host"] };
		expect(resolveTransclusionTarget("host", "t", (id) => graph[id] ?? [])).toEqual({
			ok: false,
			reason: TransclusionRejectReason.Cycle,
		});
	});

	it("rejects a pre-existing loop in the target's own subgraph", () => {
		const graph: Record<string, string[]> = { t: ["a"], a: ["t"] };
		expect(resolveTransclusionTarget("host", "t", (id) => graph[id] ?? [])).toEqual({
			ok: false,
			reason: TransclusionRejectReason.Cycle,
		});
	});

	it("rejects a chain deeper than the budget", () => {
		// host(0) → t(1) → c1(2) → c2(3); maxDepth 2 ⇒ Depth
		const graph: Record<string, string[]> = { t: ["c1"], c1: ["c2"], c2: [] };
		expect(resolveTransclusionTarget("host", "t", (id) => graph[id] ?? [], 2)).toEqual({
			ok: false,
			reason: TransclusionRejectReason.Depth,
		});
	});

	it("allows a chain exactly at the budget", () => {
		const graph: Record<string, string[]> = { t: ["c1"], c1: [] };
		// host(0) → t(1) → c1(2); maxDepth 2 ⇒ ok
		expect(resolveTransclusionTarget("host", "t", (id) => graph[id] ?? [], 2)).toEqual({
			ok: true,
		});
	});

	it("prefers Self over a cycle when both apply", () => {
		const graph: Record<string, string[]> = { n1: ["n1"] };
		expect(resolveTransclusionTarget("n1", "n1", (id) => graph[id] ?? [])).toEqual({
			ok: false,
			reason: TransclusionRejectReason.Self,
		});
	});

	it("defaults to a depth budget of MAX_TRANSCLUSION_DEPTH", () => {
		expect(MAX_TRANSCLUSION_DEPTH).toBe(10);
		// A 9-deep linear chain under host is fine at the default.
		const graph: Record<string, string[]> = {};
		for (let i = 0; i < 9; i++) graph[`c${i}`] = [`c${i + 1}`];
		graph.c9 = [];
		expect(resolveTransclusionTarget("host", "c0", (id) => graph[id] ?? [])).toEqual({
			ok: true,
		});
	});
});

describe("decideTransclusionRender (B6.4b render-time guard)", () => {
	it("renders a target that isn't in the ancestor chain", () => {
		expect(decideTransclusionRender(["host"], "target")).toBe(TransclusionRenderDecision.Render);
		expect(decideTransclusionRender([], "target")).toBe(TransclusionRenderDecision.Render);
	});

	it("elides a target that is the host (direct self-loop)", () => {
		expect(decideTransclusionRender(["host"], "host")).toBe(TransclusionRenderDecision.CycleElided);
	});

	it("elides a target already nested above this node (multi-hop loop)", () => {
		// host → a → b → (a again) would recurse forever.
		expect(decideTransclusionRender(["host", "a", "b"], "a")).toBe(
			TransclusionRenderDecision.CycleElided,
		);
	});

	it("elides once the render chain hits the depth budget", () => {
		const chain = Array.from({ length: MAX_TRANSCLUSION_DEPTH }, (_, i) => `n${i}`);
		expect(decideTransclusionRender(chain, "fresh")).toBe(TransclusionRenderDecision.DepthElided);
	});

	it("still renders one level below the budget", () => {
		const chain = Array.from({ length: MAX_TRANSCLUSION_DEPTH - 1 }, (_, i) => `n${i}`);
		expect(decideTransclusionRender(chain, "fresh")).toBe(TransclusionRenderDecision.Render);
	});

	it("prefers the cycle verdict over depth when both apply", () => {
		const chain = Array.from({ length: MAX_TRANSCLUSION_DEPTH + 2 }, (_, i) => `n${i}`);
		// `n0` is both already-in-chain AND the chain is over budget → cycle wins.
		expect(decideTransclusionRender(chain, "n0")).toBe(TransclusionRenderDecision.CycleElided);
	});

	it("honours a custom (tighter) depth budget", () => {
		expect(decideTransclusionRender(["a", "b"], "c", 2)).toBe(TransclusionRenderDecision.DepthElided);
		expect(decideTransclusionRender(["a"], "c", 2)).toBe(TransclusionRenderDecision.Render);
	});
});
