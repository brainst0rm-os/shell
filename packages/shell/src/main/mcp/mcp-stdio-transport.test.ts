import { describe, expect, it, vi } from "vitest";
import {
	type StdioChild,
	type StdioSpawn,
	callToolStdio,
	discoverToolsStdio,
} from "./mcp-stdio-transport";

/**
 * A scriptable fake MCP stdio server. It parses newline-delimited JSON-RPC
 * requests written to stdin and replies on stdout via the `respond` callback,
 * which receives the parsed method + id and returns the result object (or
 * `"error"` to emit a JSON-RPC error, or `null` to stay silent). The
 * `initialize` handshake is answered automatically.
 */
function fakeSpawn(
	respond: (method: string, params: unknown) => unknown,
	opts: { failSpawn?: boolean; exitEarly?: boolean; noPipes?: boolean } = {},
): { spawn: StdioSpawn; killed: () => boolean } {
	let killedFlag = false;
	const spawn: StdioSpawn = () => {
		if (opts.failSpawn) throw new Error("ENOENT");
		const dataListeners: Array<(chunk: string) => void> = [];
		const exitListeners: Array<(code: number | null) => void> = [];
		const emit = (msg: unknown): void => {
			const line = `${JSON.stringify(msg)}\n`;
			for (const l of dataListeners) l(line);
		};
		const child: StdioChild = {
			stdin: opts.noPipes
				? null
				: {
						write(chunk: string) {
							for (const raw of chunk.split("\n")) {
								const line = raw.trim();
								if (!line) continue;
								const req = JSON.parse(line) as { id?: number; method: string; params?: unknown };
								if (typeof req.id !== "number") continue; // notification
								if (req.method === "initialize") {
									emit({ jsonrpc: "2.0", id: req.id, result: { protocolVersion: "x" } });
									continue;
								}
								const out = respond(req.method, req.params);
								if (out === null) continue;
								if (out === "error") {
									emit({ jsonrpc: "2.0", id: req.id, error: { message: "boom" } });
									continue;
								}
								emit({ jsonrpc: "2.0", id: req.id, result: out });
							}
						},
						end() {},
					},
			stdout: opts.noPipes ? null : { on: (_e, cb) => dataListeners.push(cb as (c: string) => void) },
			on(event, listener) {
				if (event === "exit") exitListeners.push(listener as (c: number | null) => void);
			},
			kill() {
				killedFlag = true;
			},
		};
		if (opts.exitEarly) {
			queueMicrotask(() => {
				for (const l of exitListeners) l(1);
			});
		}
		return child;
	};
	return { spawn, killed: () => killedFlag };
}

describe("mcp-stdio-transport", () => {
	it("handshakes then lists tools, sanitising the descriptors", async () => {
		const { spawn, killed } = fakeSpawn((method) =>
			method === "tools/list"
				? {
						tools: [
							{ name: "read_file", description: "Read a file", annotations: { readOnlyHint: true } },
						],
					}
				: null,
		);
		const tools = await discoverToolsStdio(spawn, "npx", ["server-fs"]);
		expect(tools).toHaveLength(1);
		expect(tools[0]?.name).toBe("read_file");
		expect(tools[0]?.readOnlyHint).toBe(true);
		expect(killed()).toBe(true); // process killed after the RPC (spawn-per-RPC)
	});

	it("calls a tool and returns its (untrusted) content + isError", async () => {
		const { spawn } = fakeSpawn((method, params) => {
			expect(method).toBe("tools/call");
			expect((params as { name: string }).name).toBe("read_file");
			return { content: [{ type: "text", text: "hello" }], isError: false };
		});
		const res = await callToolStdio(spawn, "npx", ["server-fs"], "read_file", { path: "/x" });
		expect(res.isError).toBe(false);
		expect(res.content).toEqual([{ type: "text", text: "hello" }]);
	});

	it("surfaces a JSON-RPC error as a transport error", async () => {
		const { spawn } = fakeSpawn(() => "error");
		await expect(discoverToolsStdio(spawn, "npx", [])).rejects.toThrow(/boom/);
	});

	it("fails closed when the process can't spawn", async () => {
		const { spawn } = fakeSpawn(() => ({}), { failSpawn: true });
		await expect(discoverToolsStdio(spawn, "nope", [])).rejects.toThrow(/spawn failed/);
	});

	it("fails closed when the process exits before responding", async () => {
		const { spawn } = fakeSpawn(() => null, { exitEarly: true });
		await expect(discoverToolsStdio(spawn, "npx", [])).rejects.toThrow(/exited/);
	});

	it("fails closed when spawn produces no pipes", async () => {
		const { spawn } = fakeSpawn(() => ({}), { noPipes: true });
		await expect(discoverToolsStdio(spawn, "npx", [])).rejects.toThrow(/no stdio pipes/);
	});

	it("refuses to spawn past the concurrency cap (DoS floor)", async () => {
		vi.useFakeTimers();
		try {
			// A server that answers `initialize` but never the method → each call
			// stays in-flight (hung on its discovery timeout), holding a spawn slot.
			const { spawn } = fakeSpawn(() => null);
			const inflight = Array.from({ length: 8 }, () =>
				discoverToolsStdio(spawn, "npx", []).catch(() => "settled"),
			);
			// The 9th concurrent spawn is refused fail-closed (cap is 8).
			await expect(discoverToolsStdio(spawn, "npx", [])).rejects.toThrow(/refusing to spawn/);
			// Drain the 8 (their timeout + SIGKILL grace) so the counter resets.
			await vi.advanceTimersByTimeAsync(15_000);
			expect(await Promise.all(inflight)).toEqual(Array(8).fill("settled"));
			// Counter reset: a fresh spawn is admitted again (rejects on its own timeout).
			const after = discoverToolsStdio(spawn, "npx", []).catch(() => "settled");
			await vi.advanceTimersByTimeAsync(15_000);
			expect(await after).toBe("settled");
		} finally {
			vi.useRealTimers();
		}
	});
});
