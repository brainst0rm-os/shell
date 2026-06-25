/**
 * MCP integrations contract leaf (doc 64 — MCP-1/-3/-4).
 *
 * Brainstorm consumes external MCP servers as an MCP **client**: the user
 * connects a server, its `tools/list` tools project into the shared agent loop
 * ({@link ../agent-loop}) as {@link McpAgentTool}s, and the broker routes a
 * `tools/call` under the fail-closed capability intersection. This leaf is
 * dependency-free pure logic so the projection, the capability gate, the
 * confirm-writes/hint friction decision, and the rug-pull fingerprint are all
 * exhaustively unit-testable without the shell, the network, or the DOM.
 *
 * **Security keystones (reviewed — doc 64 §Trust + §Prompt injection):**
 * - Server-supplied tool names / descriptions / annotations are UNTRUSTED
 *   external input (prompt-injection vector). They are length-capped, never
 *   treated as instructions, and surfaced verbatim-but-marked to the user.
 * - A tool is callable only if it is in
 *     enabled-server-tools ∩ conversation-grants ∩ app-caps
 *   computed fail-closed by {@link mcpServerCapability} +
 *   {@link intersectMcpTools} — a tool of a server the frozen set does not
 *   grant `mcp.server:<id>` is never offered (and re-checked at dispatch).
 * - The server's `readOnlyHint` lowers FRICTION but is NEVER a security
 *   boundary ({@link decideToolFriction}): writes confirm regardless.
 * - A tool whose description/annotations change after approval RE-PROMPTS
 *   ({@link toolDescriptorFingerprint} + {@link detectRugPull}).
 *
 * stdio (local-process) transport (MCP-2, OQ-MCP-2 resolved) spawns the server
 * as a plain child process gated on the scarce, default-off
 * {@link MCP_SPAWN_LOCAL_CAP} capability (in addition to the per-server
 * `mcp.server:<id>` grant). The {@link McpServerConfig} carries the `command` +
 * `args` for it; no config-supplied env (a secret-leak surface).
 */

/** The transport family a server speaks over. The wire/config value IS the
 *  string — centralised here per the no-raw-string-discriminators rule. */
export enum McpTransportKind {
	/** Streamable-HTTP (the modern MCP HTTP transport — one POST endpoint). */
	StreamableHttp = "streamable-http",
	/** Server-Sent-Events (the legacy HTTP transport — POST + an SSE stream). */
	Sse = "sse",
	/** Local child process over stdio — OUT OF SCOPE for v1 (OQ-MCP-2). */
	Stdio = "stdio",
}

/** The HTTP transport families (a remote endpoint over the egress broker). */
export const HTTP_MCP_TRANSPORTS: readonly McpTransportKind[] = [
	McpTransportKind.StreamableHttp,
	McpTransportKind.Sse,
];

/** Is this transport a remote HTTP family (vs. the local stdio child)? */
export function isHttpMcpTransport(kind: McpTransportKind): boolean {
	return HTTP_MCP_TRANSPORTS.includes(kind);
}

/** Is this the local-process stdio transport (MCP-2)? Spawning it requires the
 *  {@link MCP_SPAWN_LOCAL_CAP} grant on top of the per-server `mcp.server:<id>`. */
export function isStdioMcpTransport(kind: McpTransportKind): boolean {
	return kind === McpTransportKind.Stdio;
}

/** The scarce, default-off capability that gates spawning ANY local stdio MCP
 *  server (OQ-MCP-2). Re-checked against the live ledger in the broker; the
 *  exact command line is shown for consent before it is granted. Distinct from
 *  the per-server `mcp.server:<id>` grant — both are required for a stdio call. */
export const MCP_SPAWN_LOCAL_CAP = "mcp.spawn-local";

/** Upper bound on a stdio server's argv length — bounds the config + the UI and
 *  keeps a hand-edited record from spawning a pathological command line. */
export const MCP_STDIO_MAX_ARGS = 64;

// Reject ASCII control chars (incl. NUL/newline) in spawn argv — they can't
// appear in a real executable path/arg and would corrupt the command line the
// consent UI shows. Spaces/punctuation ARE allowed (argv is passed verbatim
// with `shell: false`, so a path like "/Apps/My Server/bin" is fine).
// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting C0/DEL in spawn argv is the security intent
const STDIO_CONTROL_CHARS = /[\x00-\x1f\x7f]/;

/** Validate a stdio `command` (a non-empty string, no control chars) — the
 *  executable or interpreter to spawn. The argv is passed verbatim with
 *  `shell: false`, so this is a path/name, never a shell line. */
export function isValidStdioCommand(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0 && !STDIO_CONTROL_CHARS.test(value);
}

/** Validate a stdio `args` array — up to {@link MCP_STDIO_MAX_ARGS} control-char-free
 *  strings. Absent/empty is fine (many servers take no args). */
export function isValidStdioArgs(value: unknown): value is readonly string[] {
	return (
		Array.isArray(value) &&
		value.length <= MCP_STDIO_MAX_ARGS &&
		value.every((a) => typeof a === "string" && !STDIO_CONTROL_CHARS.test(a))
	);
}

/** Health of a connected server (doc 64 §Performance budgets — a down server is
 *  isolated, never blocks the loop). The wire value IS the string. */
export enum McpServerHealth {
	/** Handshook + reachable; tools are offerable. */
	Connected = "connected",
	/** Reachable but slow / partial (past the budget). Tools still offerable. */
	Degraded = "degraded",
	/** Unreachable / never connected on this device. Tools drop out. */
	Down = "down",
	/** Configured but not enabled on this device. */
	Disabled = "disabled",
}

/** Length caps for untrusted server-supplied text (prompt-injection floor —
 *  doc 64 §Prompt injection "length-capped"). A server cannot grow the system
 *  prompt without bound by stuffing a megabyte description. */
export const MCP_TOOL_NAME_MAX = 128;
export const MCP_TOOL_DESCRIPTION_MAX = 4_096;

/** Hard cap on tools projected per server — a runaway `tools/list` cannot flood
 *  the harness. */
export const MCP_TOOLS_PER_SERVER_MAX = 256;

/**
 * The per-vault server config RECORD (OQ-MCP-1: the record syncs across the
 * user's devices). Holds NO secret — the auth credential lives in the Tier-2
 * credential store keyed by {@link mcpServerCredentialKeyName}. Enablement is
 * per-DEVICE and lives separately ({@link McpEnablement}); this record only says
 * the server exists + how to reach it.
 */
export type McpServerConfig = {
	/** User-assigned, stable; the `mcp.server:<id>` capability scope key. */
	readonly id: string;
	/** Human-facing name (shown in Settings). */
	readonly name: string;
	readonly transport: McpTransportKind;
	/** The endpoint URL (HTTP transports). Required for HTTP; absent for stdio. */
	readonly url?: string;
	/** The executable/interpreter to spawn (stdio transport only, MCP-2).
	 *  Required for stdio; absent for HTTP. Spawned with `shell: false` — argv is
	 *  verbatim, never a shell line. Shown for consent before spawning. */
	readonly command?: string;
	/** Argv for the stdio `command` (verbatim, `shell: false`). Optional. */
	readonly args?: readonly string[];
	/** Whether the server requires an auth secret (a bearer token in the Tier-2
	 *  store). The secret itself is NEVER in the config record. */
	readonly requiresAuth: boolean;
	readonly createdAt: number;
	readonly updatedAt: number;
};

/** A server id is the cap scope, so it is constrained to the same safe set the
 *  credential store accepts as a key fragment. */
const SERVER_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export function isValidMcpServerId(id: unknown): id is string {
	return typeof id === "string" && SERVER_ID_PATTERN.test(id);
}

/**
 * A single tool a server exposes (from `tools/list`). Every text field is
 * UNTRUSTED external input — already length-capped + sanitised by
 * {@link sanitizeToolDescriptor} before it reaches here.
 */
export type McpToolDescriptor = {
	/** The tool's name as the server reported it (UNTRUSTED). */
	readonly name: string;
	/** The tool's description (UNTRUSTED — shown verbatim-but-marked, never run
	 *  as an instruction). */
	readonly description: string;
	/** The MCP `readOnlyHint` annotation — lowers FRICTION, never a boundary. */
	readonly readOnlyHint: boolean;
	/** The MCP `destructiveHint` annotation — raises friction (always confirm). */
	readonly destructiveHint: boolean;
	/** The tool's JSON-Schema input shape, opaque + passed to the model as-is. */
	readonly inputSchema?: unknown;
};

/** The capability a conversation/app needs to use a server at all (OQ-MCP-3:
 *  server-level grant in v1). `<id>` is the server id. */
export function mcpServerCapability(serverId: string): string {
	return `mcp.server:${serverId}`;
}

/** The credential-store key fragment for a server's auth secret. The credential
 *  module (main-only) names the `app` namespace. */
export function mcpServerCredentialKeyName(serverId: string): string {
	return `mcp-server-auth:${serverId}`;
}

/** The namespaced tool id the agent loop addresses (doc 64 §interface —
 *  `mcp.<serverId>.<toolName>`, so two servers' `search` never collide). */
export function mcpToolId(serverId: string, toolName: string): string {
	return `mcp.${serverId}.${toolName}`;
}

/** An {@link import("./automations").AgentTool}-shaped projection of an MCP
 *  tool. Shaped to drop straight into {@link McpAgentTool}'s `verb` slot for the
 *  shared loop, carrying the originating server id + the (untrusted) descriptor
 *  for friction + provenance + rug-pull checks. */
export type McpAgentTool = {
	/** The namespaced tool id (the loop's stable address). */
	readonly verb: string;
	/** The (untrusted) human-facing description fed to the model + UI. */
	readonly label: string;
	/** The server this tool belongs to. */
	readonly serverId: string;
	/** The original (untrusted) tool name for the `tools/call` dispatch. */
	readonly toolName: string;
	readonly readOnlyHint: boolean;
	readonly destructiveHint: boolean;
};

/**
 * Sanitise one raw `tools/list` entry into a length-capped {@link McpToolDescriptor}.
 * Pure + defensive: a malformed entry returns null (dropped, never offered),
 * over-long text is truncated, missing annotations default to the SAFE side
 * (not read-only → confirm; not destructive). Never throws.
 */
export function sanitizeToolDescriptor(raw: unknown): McpToolDescriptor | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Record<string, unknown>;
	const name = typeof r.name === "string" ? r.name.trim() : "";
	if (name.length === 0) return null;
	const annotations =
		r.annotations && typeof r.annotations === "object"
			? (r.annotations as Record<string, unknown>)
			: {};
	const description = typeof r.description === "string" ? r.description : "";
	return {
		name: name.slice(0, MCP_TOOL_NAME_MAX),
		description: description.slice(0, MCP_TOOL_DESCRIPTION_MAX),
		// Default to the SAFE side: a server that omits the hint is treated as
		// write (confirm). `readOnlyHint` must be an explicit `true`.
		readOnlyHint: annotations.readOnlyHint === true,
		destructiveHint: annotations.destructiveHint === true,
		...(r.inputSchema !== undefined ? { inputSchema: r.inputSchema } : {}),
	};
}

/**
 * Project a server's sanitised tools into the loop's tool surface. Pure +
 * deterministic. Caps the count ({@link MCP_TOOLS_PER_SERVER_MAX}) so a runaway
 * server can't flood the harness.
 */
export function projectMcpTools(
	serverId: string,
	tools: readonly McpToolDescriptor[],
): McpAgentTool[] {
	return tools.slice(0, MCP_TOOLS_PER_SERVER_MAX).map((tool) => ({
		verb: mcpToolId(serverId, tool.name),
		label: tool.description,
		serverId,
		toolName: tool.name,
		readOnlyHint: tool.readOnlyHint,
		destructiveHint: tool.destructiveHint,
	}));
}

/**
 * The fail-closed MCP tool intersection (security keystone — the MCP analogue of
 * {@link import("./agent-loop").intersectAgentTools}). A projected tool is
 * offered only when the frozen capability set grants its server's
 * `mcp.server:<id>` (OQ-MCP-3 server-level grant). A tool whose server the
 * frozen set does not cover is dropped, never offered — and the dispatch path
 * re-checks (defence in depth). Pure + deterministic so it is property-tested.
 */
export function intersectMcpTools(
	projected: readonly McpAgentTool[],
	frozenCapabilities: readonly string[],
): McpAgentTool[] {
	const granted = new Set(frozenCapabilities);
	return projected.filter((tool) => granted.has(mcpServerCapability(tool.serverId)));
}

/** Whether the frozen capability set permits calling a given server (the
 *  dispatch-time re-check — never trusted from the model). */
export function isServerGranted(serverId: string, frozenCapabilities: readonly string[]): boolean {
	return frozenCapabilities.includes(mcpServerCapability(serverId));
}

/** Why a tool call needs (or doesn't need) a confirmation (doc 64 §friction). */
export enum McpFrictionDecision {
	/** A hinted-safe READ under a granted server scope — may auto-run. */
	AutoRun = "auto-run",
	/** A write / unknown / destructive tool — a named, confirmable step. */
	Confirm = "confirm",
}

/**
 * The confirm-writes / read-only-hint friction model (OQ-MCP-4). A tool MAY
 * auto-run ONLY when it is annotated read-only AND not destructive. Everything
 * else confirms. The hint LOWERS friction; it is **never** a security boundary —
 * the capability intersection already gates whether the tool is callable at all,
 * the audit records every call regardless, and a lying server's "read-only" tool
 * that actually writes is still bounded by `mcp.server:<id>`. Pure.
 */
export function decideToolFriction(tool: {
	readonly readOnlyHint: boolean;
	readonly destructiveHint: boolean;
}): McpFrictionDecision {
	if (tool.readOnlyHint && !tool.destructiveHint) return McpFrictionDecision.AutoRun;
	return McpFrictionDecision.Confirm;
}

/**
 * A stable fingerprint of the user-approved surface of a tool — its name,
 * description, and both annotation hints. If ANY of these change after the user
 * approved the server, {@link detectRugPull} re-prompts (the rug-pull attack:
 * a server swaps a benign description for a malicious one post-approval).
 * Deterministic, JSON-stable, no crypto needed (it's a change-detector, not a
 * MAC — the threat is the server changing its own data, not forging ours).
 */
export function toolDescriptorFingerprint(tool: McpToolDescriptor): string {
	return JSON.stringify([tool.name, tool.description, tool.readOnlyHint, tool.destructiveHint]);
}

/** The approved fingerprint set for a server — `toolName → fingerprint` at the
 *  moment the user approved/last-reviewed the server. */
export type McpApprovedFingerprints = Readonly<Record<string, string>>;

/** Why a tool needs re-approval (drives the UI affordance). */
export enum McpRugPullKind {
	/** A previously-approved tool's surface changed (description/hint/name). */
	Changed = "changed",
	/** A tool the user never approved appeared. */
	New = "new",
}

export type McpRugPull = {
	readonly toolName: string;
	readonly kind: McpRugPullKind;
};

/**
 * Detect rug-pulls: compare the server's CURRENT tool surface against the
 * fingerprints the user approved. A tool whose fingerprint changed (Changed) or
 * that wasn't approved at all (New) must be re-confirmed before it can auto-run.
 * A tool that vanished is not a rug-pull (it just drops out of the offerable
 * set). Pure + deterministic.
 */
export function detectRugPull(
	current: readonly McpToolDescriptor[],
	approved: McpApprovedFingerprints,
): McpRugPull[] {
	const out: McpRugPull[] = [];
	for (const tool of current) {
		const prior = approved[tool.name];
		if (prior === undefined) {
			out.push({ toolName: tool.name, kind: McpRugPullKind.New });
		} else if (prior !== toolDescriptorFingerprint(tool)) {
			out.push({ toolName: tool.name, kind: McpRugPullKind.Changed });
		}
	}
	return out;
}

/** Build the approved-fingerprint map for a server's current tool surface — the
 *  value stored when the user approves/re-reviews. */
export function fingerprintTools(tools: readonly McpToolDescriptor[]): McpApprovedFingerprints {
	const out: Record<string, string> = {};
	for (const tool of tools) out[tool.name] = toolDescriptorFingerprint(tool);
	return out;
}
