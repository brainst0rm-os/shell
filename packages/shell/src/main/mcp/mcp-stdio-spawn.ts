/**
 * Production binding of the stdio {@link StdioSpawn} seam to Node's
 * `child_process.spawn` (MCP-2). Isolated here so {@link mcp-stdio-transport} stays
 * pure (testable without spawning a real process).
 *
 * SECURITY: **`shell: false`** — argv is passed verbatim, never interpreted by a
 * shell, so there is no shell-injection surface (the command + args came from
 * the user-reviewed config, and the broker gated the spawn on `mcp.spawn-local`
 * before reaching here). stderr is ignored (`"ignore"`) so a chatty server
 * can't fill a pipe; the parent env is inherited (PATH resolution) but config
 * supplies NO env (a secret-leak surface, OQ-MCP-2 resolution).
 */

import { spawn } from "node:child_process";
import type { StdioChild, StdioSpawn } from "./mcp-stdio-transport";

export const nodeStdioSpawn: StdioSpawn = (command, args) =>
	spawn(command, [...args], {
		shell: false,
		stdio: ["pipe", "pipe", "ignore"],
		env: process.env,
		// No console window flashes on Windows for a GUI-launched server.
		windowsHide: true,
	}) as unknown as StdioChild;
