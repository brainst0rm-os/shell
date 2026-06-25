import { describe, expect, it } from "vitest";
import {
	AGENT_LOOP_MAX_ITERATIONS_CEILING,
	type AgentLoopPorts,
	AgentStopReason,
	type AgentToolCall,
	ToolRefusalReason,
	buildAgentSystemPrompt,
	intersectAgentTools,
	parseAgentReply,
	runAgentLoop,
} from "./agent-loop";
import type { AgentTool } from "./automations";
import { type AiChatMessage, MessageRole, messageText } from "./conversation";

const searchTool: AgentTool = { verb: "search", label: "Search the vault" };
const noteTool: AgentTool = {
	verb: "create",
	entityType: "brainstorm/Note/v1",
	label: "Create a note",
};

/** A scripted `generate` that returns the next canned reply per call. */
function scriptedPorts(
	replies: readonly string[],
	dispatch: (call: AgentToolCall) => Promise<unknown> = async () => null,
): AgentLoopPorts & { seen: AiChatMessage[][]; dispatched: AgentToolCall[] } {
	const seen: AiChatMessage[][] = [];
	const dispatched: AgentToolCall[] = [];
	let i = 0;
	return {
		seen,
		dispatched,
		generate: async (messages) => {
			seen.push([...messages]);
			const content = replies[Math.min(i, replies.length - 1)] ?? '{"final":"done"}';
			i++;
			return { content, provenance: { provider: "ollama", model: "m", generatedAt: "t" } };
		},
		dispatchTool: async (call) => {
			dispatched.push(call);
			return dispatch(call);
		},
	};
}

describe("intersectAgentTools (security keystone)", () => {
	it("offers a tool only when its full capability footprint is held", () => {
		const tools = [searchTool, noteTool];
		const offered = intersectAgentTools(tools, [
			"intents.dispatch:search",
			"intents.dispatch:create",
			"entities.read:brainstorm/Note/v1",
		]);
		expect(offered.map((t) => t.verb)).toEqual(["search", "create"]);
	});

	it("drops a tool whose entity-read cap is missing (partial coverage fails closed)", () => {
		const offered = intersectAgentTools(
			[noteTool],
			// has the dispatch cap but NOT the implied entities.read scope
			["intents.dispatch:create"],
		);
		expect(offered).toEqual([]);
	});

	it("a `*` scope grant covers a scoped tool requirement", () => {
		const offered = intersectAgentTools([noteTool], ["intents.dispatch:create", "entities.read:*"]);
		expect(offered.map((t) => t.verb)).toEqual(["create"]);
	});

	it("property: offered ⊆ declared, and every offered tool's caps are fully held", () => {
		// Deterministic pseudo-random sampling (no fast-check dependency in this
		// contract leaf): the two invariants the security keystone must hold over
		// arbitrary declared-tool / frozen-cap combinations.
		const verbs = ["search", "create", "open", "delete"];
		const types: (string | undefined)[] = ["A", "B", undefined];
		const capPool = [
			"intents.dispatch:search",
			"intents.dispatch:create",
			"intents.dispatch:open",
			"entities.read:A",
			"entities.read:B",
			"entities.read:*",
			"unrelated.cap",
		];
		let seed = 12345;
		const rnd = (n: number): number => {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			return seed % n;
		};
		const pick = <T>(arr: readonly T[]): T => arr[rnd(arr.length)] as T;

		for (let trial = 0; trial < 300; trial++) {
			const declared: AgentTool[] = Array.from({ length: rnd(5) }, () => {
				const t = pick(types);
				return { verb: pick(verbs), label: "x", ...(t ? { entityType: t } : {}) };
			});
			const frozen = Array.from({ length: rnd(capPool.length) }, () => pick(capPool));
			const offered = intersectAgentTools(declared, frozen);
			for (const tool of offered) {
				expect(declared).toContain(tool);
				const reqs = [
					`intents.dispatch:${tool.verb}`,
					...(tool.entityType ? [`entities.read:${tool.entityType}`] : []),
				];
				for (const req of reqs) {
					expect(frozen.some((h) => h === req || h === req.replace(/:[^:]*$/, ":*"))).toBe(true);
				}
			}
		}
	});
});

describe("parseAgentReply", () => {
	it("parses a tool call", () => {
		expect(parseAgentReply('{"tool":"search","args":{"q":"x"}}')).toEqual({
			kind: "tool",
			call: { tool: "search", args: { q: "x" } },
		});
	});

	it("parses a final answer with citations", () => {
		expect(parseAgentReply('{"final":"hi","citations":["a","b"]}')).toEqual({
			kind: "final",
			answer: "hi",
			citations: ["a", "b"],
		});
	});

	it("extracts JSON from a fenced / prose-wrapped reply", () => {
		const parsed = parseAgentReply('Sure!\n```json\n{"tool":"search","args":{}}\n```');
		expect(parsed).toEqual({ kind: "tool", call: { tool: "search", args: {} } });
	});

	it("returns null for non-protocol prose (loop treats as final)", () => {
		expect(parseAgentReply("I think the answer is 42.")).toBeNull();
	});

	it("missing args defaults to an empty object", () => {
		expect(parseAgentReply('{"tool":"search"}')).toEqual({
			kind: "tool",
			call: { tool: "search", args: {} },
		});
	});
});

describe("buildAgentSystemPrompt", () => {
	it("lists offered tools and the JSON protocol", () => {
		const prompt = buildAgentSystemPrompt("Do the thing.", [searchTool, noteTool]);
		expect(prompt).toContain("search: Search the vault");
		expect(prompt).toContain("create: Create a note (entity type: brainstorm/Note/v1)");
		expect(prompt).toContain('{"tool": "<name>"');
		expect(prompt).toContain('{"final"');
	});

	it("notes when no tools are available", () => {
		expect(buildAgentSystemPrompt("x", [])).toContain("(none");
	});
});

describe("runAgentLoop", () => {
	const config = (over: Partial<Parameters<typeof runAgentLoop>[1]> = {}) => ({
		instructions: "Find the note.",
		tools: [searchTool],
		frozenCapabilities: ["intents.dispatch:search"],
		...over,
	});

	it("dispatches a tool, feeds the result back, then returns the final answer", async () => {
		const ports = scriptedPorts(
			['{"tool":"search","args":{"q":"abc"}}', '{"final":"found it","citations":["n1"]}'],
			async () => ({ hits: 1 }),
		);
		const result = await runAgentLoop(ports, config());
		expect(result.stopReason).toBe(AgentStopReason.Final);
		expect(result.finalAnswer).toBe("found it");
		expect(result.citations).toEqual(["n1"]);
		expect(ports.dispatched).toEqual([{ tool: "search", args: { q: "abc" } }]);
		// The tool result was fed back as a tool-role message before the 2nd generate.
		const secondCall = ports.seen[1] ?? [];
		expect(
			secondCall.some((m) => m.role === MessageRole.Tool && messageText(m.content).includes("hits")),
		).toBe(true);
		expect(result.iterations).toBe(2);
	});

	it("refuses a tool not in the offered set (fail-closed), then continues", async () => {
		const ports = scriptedPorts([
			'{"tool":"delete","args":{}}', // not offered
			'{"final":"ok"}',
		]);
		const result = await runAgentLoop(ports, config());
		expect(ports.dispatched).toEqual([]); // never dispatched
		const refusal = result.steps.find((s) => s.kind === "tool-refused");
		expect(refusal).toEqual({
			kind: "tool-refused",
			tool: "delete",
			reason: ToolRefusalReason.UnknownTool,
		});
		expect(result.finalAnswer).toBe("ok");
	});

	it("refuses a declared tool whose caps the frozen set does not cover", async () => {
		const ports = scriptedPorts(['{"tool":"create","args":{}}', '{"final":"done"}']);
		// `create` is declared but the note-read cap is absent → never offered.
		const result = await runAgentLoop(
			ports,
			config({ tools: [noteTool], frozenCapabilities: ["intents.dispatch:create"] }),
		);
		expect(ports.dispatched).toEqual([]);
		expect(result.steps.some((s) => s.kind === "tool-refused")).toBe(true);
	});

	it("bounds iterations and never exceeds the ceiling", async () => {
		// Always asks for a tool → would loop forever without the bound.
		const ports = scriptedPorts(['{"tool":"search","args":{}}']);
		const result = await runAgentLoop(ports, config({ maxIterations: 1000 }));
		expect(result.stopReason).toBe(AgentStopReason.MaxIterations);
		expect(result.iterations).toBe(AGENT_LOOP_MAX_ITERATIONS_CEILING);
	});

	it("honours a small maxIterations", async () => {
		const ports = scriptedPorts(['{"tool":"search","args":{}}']);
		const result = await runAgentLoop(ports, config({ maxIterations: 2 }));
		expect(result.iterations).toBe(2);
		expect(result.stopReason).toBe(AgentStopReason.MaxIterations);
	});

	it("treats non-protocol prose as the final answer (always terminates)", async () => {
		const ports = scriptedPorts(["The answer is 42."]);
		const result = await runAgentLoop(ports, config());
		expect(result.stopReason).toBe(AgentStopReason.Final);
		expect(result.finalAnswer).toBe("The answer is 42.");
		expect(result.iterations).toBe(1);
	});

	it("stops with GenerateFailed when generate throws", async () => {
		const ports: AgentLoopPorts = {
			generate: async () => {
				throw new Error("provider down");
			},
			dispatchTool: async () => null,
		};
		const result = await runAgentLoop(ports, config());
		expect(result.stopReason).toBe(AgentStopReason.GenerateFailed);
		expect(result.error).toBe("provider down");
		expect(result.finalAnswer).toBe("");
	});

	it("a tool dispatch error is recorded and fed back, loop continues", async () => {
		const ports = scriptedPorts(
			['{"tool":"search","args":{}}', '{"final":"recovered"}'],
			async () => {
				throw new Error("boom");
			},
		);
		const result = await runAgentLoop(ports, config());
		const err = result.steps.find((s) => s.kind === "tool-error");
		expect(err).toMatchObject({ kind: "tool-error", tool: "search", error: "boom" });
		expect(result.finalAnswer).toBe("recovered");
	});
});
