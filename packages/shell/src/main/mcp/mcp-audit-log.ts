/**
 * Per-call MCP audit log (doc 64 §Provenance and audit — MCP-1/-4).
 *
 * Every `tools/call` lands one JSON-lines record: the server id, the tool name,
 * the argument *SHAPE* (the set of arg keys, NEVER their values — a secret in an
 * arg is never logged), the outcome, the latency, and the originating app. This
 * is the same posture the AI provenance log (11.8) takes; it reuses the network
 * audit's generic file sink so there's one JSONL machine, not three. The raw log
 * stays shell-side and never crosses IPC.
 */

import type { AiUsageSink } from "../ai/ai-usage-log";

export enum McpCallOutcome {
	/** The tool returned content. */
	Ok = "ok",
	/** The tool reported an error (`isError`) or the call refused/failed. */
	Error = "error",
	/** The call was refused before dispatch (no server / no grant / down). */
	Refused = "refused",
}

export type McpCallRecord = {
	readonly ts: number;
	/** Originating app id (the broker envelope's `app`). */
	readonly appId: string;
	readonly serverId: string;
	readonly toolName: string;
	/** The ARG KEYS only — never values. `["title","body"]` says which fields
	 *  were set, never the secret one of them might carry. */
	readonly argKeys: readonly string[];
	readonly outcome: McpCallOutcome;
	readonly durationMs: number;
	/** A short reason on a refusal/error (no untrusted server text echoed). */
	readonly reason?: string;
};

/** The arg-shape: the sorted set of top-level keys, values stripped. Pure. */
export function argKeysOf(args: unknown): string[] {
	if (!args || typeof args !== "object" || Array.isArray(args)) return [];
	return Object.keys(args as Record<string, unknown>).sort();
}

/** Write one MCP call record. Best-effort: a sink throw is logged + swallowed so
 *  a full disk never breaks a tool call (the gap shows as a missing row). */
export async function recordMcpCall(sink: AiUsageSink, record: McpCallRecord): Promise<void> {
	try {
		await sink(JSON.stringify(record));
	} catch (error) {
		console.warn(`[mcp/audit] sink failed: ${(error as Error).message}`);
	}
}
