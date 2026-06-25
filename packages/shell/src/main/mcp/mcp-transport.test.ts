import { describe, expect, it, vi } from "vitest";
import { type McpFetchJson, McpTransportError, callTool, discoverTools } from "./mcp-transport";

const NO_AUTH = {} as const;

function jsonRpc(result: unknown): string {
	return JSON.stringify({ jsonrpc: "2.0", id: 1, result });
}

describe("discoverTools", () => {
	it("sanitises + projects a tools/list response", async () => {
		const fetchJson: McpFetchJson = async () => ({
			status: 200,
			text: jsonRpc({
				tools: [
					{ name: "search", description: "find", annotations: { readOnlyHint: true } },
					{ name: "", description: "dropped" },
					{ description: "no name dropped" },
				],
			}),
		});
		const tools = await discoverTools(fetchJson, "https://x/mcp", NO_AUTH);
		expect(tools).toHaveLength(1);
		expect(tools[0]).toMatchObject({ name: "search", readOnlyHint: true, destructiveHint: false });
	});

	it("forwards the auth header but not as a logged value", async () => {
		const seen: Record<string, string>[] = [];
		const fetchJson: McpFetchJson = async (input) => {
			seen.push({ ...input.headers });
			return { status: 200, text: jsonRpc({ tools: [] }) };
		};
		await discoverTools(fetchJson, "https://x/mcp", { Authorization: "Bearer secret" });
		expect(seen[0]?.Authorization).toBe("Bearer secret");
	});

	it("accepts an SSE-framed (data:) JSON-RPC body", async () => {
		const fetchJson: McpFetchJson = async () => ({
			status: 200,
			text: `event: message\ndata: ${jsonRpc({ tools: [{ name: "t", description: "d" }] })}\n\n`,
		});
		const tools = await discoverTools(fetchJson, "https://x/mcp", NO_AUTH);
		expect(tools[0]?.name).toBe("t");
	});

	it("throws (fails closed) on a non-2xx status", async () => {
		const fetchJson: McpFetchJson = async () => ({ status: 502, text: "" });
		await expect(discoverTools(fetchJson, "https://x", NO_AUTH)).rejects.toBeInstanceOf(
			McpTransportError,
		);
	});

	it("throws on a JSON-RPC error member", async () => {
		const fetchJson: McpFetchJson = async () => ({
			status: 200,
			text: JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message: "boom" } }),
		});
		await expect(discoverTools(fetchJson, "https://x", NO_AUTH)).rejects.toThrow(/boom/);
	});
});

describe("callTool", () => {
	it("returns content + isError, sending name + arguments", async () => {
		const fetchJson = vi.fn<McpFetchJson>(async () => ({
			status: 200,
			text: jsonRpc({ content: [{ type: "text", text: "ok" }], isError: false }),
		}));
		const result = await callTool(fetchJson, "https://x", NO_AUTH, "create", { title: "t" });
		expect(result.isError).toBe(false);
		expect(result.content).toEqual([{ type: "text", text: "ok" }]);
		const body = fetchJson.mock.calls[0]?.[0].bodyJson as { method: string; params: unknown };
		expect(body.method).toBe("tools/call");
		expect(body.params).toEqual({ name: "create", arguments: { title: "t" } });
	});

	it("propagates isError true (tool-reported error)", async () => {
		const fetchJson: McpFetchJson = async () => ({
			status: 200,
			text: jsonRpc({ content: "nope", isError: true }),
		});
		expect((await callTool(fetchJson, "https://x", NO_AUTH, "t", {})).isError).toBe(true);
	});
});
