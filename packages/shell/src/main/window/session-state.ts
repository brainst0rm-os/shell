/**
 * `session.json` — last running apps + window placement, per
 *  §Persistence layout.
 *
 *   {
 *     "version": 1,
 *     "windows": [
 *       {
 *         "appId": "io.example.text-editor",
 *         "windowId": "main",
 *         "monitorId": "mon_v1:abcdef12",
 *         "placement": { "x": 100, "y": 100, "width": 1280, "height": 800,
 *                        "maximized": false },
 *         "updatedAt": 1715473200000
 *       }
 *     ],
 *     "lastClosedAt": 1715473200000
 *   }
 *
 * Lives at `<vault>/shell/session.json`. Read on launch; written on every
 * window-position change (debounced upstream by the window manager). The
 * file is plaintext — placement isn't sensitive, and "where I last left my
 * window" is the kind of thing a user might want to inspect by hand.
 *
 * Pure I/O: no Electron deps. Safe to unit-test under Bun.
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { WindowPlacement } from "./monitor";

export const SESSION_FILENAME = "session.json";
const FORMAT_VERSION = 1;

export type SessionWindow = {
	appId: string;
	windowId: string;
	monitorId: string;
	placement: WindowPlacement;
	updatedAt: number;
};

export type SessionState = {
	version: typeof FORMAT_VERSION;
	windows: SessionWindow[];
	lastClosedAt: number | null;
};

const EMPTY: SessionState = {
	version: FORMAT_VERSION,
	windows: [],
	lastClosedAt: null,
};

export function sessionPath(vaultPath: string): string {
	return join(vaultPath, "shell", SESSION_FILENAME);
}

export async function readSession(vaultPath: string): Promise<SessionState> {
	try {
		const raw = await readFile(sessionPath(vaultPath), "utf8");
		const parsed = JSON.parse(raw) as Partial<SessionState>;
		if (!parsed || parsed.version !== FORMAT_VERSION || !Array.isArray(parsed.windows)) {
			return cloneEmpty();
		}
		const windows: SessionWindow[] = [];
		for (const w of parsed.windows) {
			if (isSessionWindow(w)) windows.push(w);
		}
		return {
			version: FORMAT_VERSION,
			windows,
			lastClosedAt:
				typeof parsed.lastClosedAt === "number" || parsed.lastClosedAt === null
					? (parsed.lastClosedAt ?? null)
					: null,
		};
	} catch (error) {
		if (isNotFound(error)) return cloneEmpty();
		console.warn("[brainstorm] session.json read failed; treating as empty:", error);
		return cloneEmpty();
	}
}

export async function writeSession(vaultPath: string, state: SessionState): Promise<void> {
	const path = sessionPath(vaultPath);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

/** Test helper. */
export async function clearSession(vaultPath: string): Promise<void> {
	await rm(sessionPath(vaultPath), { force: true });
}

function cloneEmpty(): SessionState {
	return { ...EMPTY, windows: [] };
}

function isSessionWindow(value: unknown): value is SessionWindow {
	if (!value || typeof value !== "object") return false;
	const w = value as Partial<SessionWindow>;
	return (
		typeof w.appId === "string" &&
		typeof w.windowId === "string" &&
		typeof w.monitorId === "string" &&
		typeof w.updatedAt === "number" &&
		isPlacement(w.placement)
	);
}

function isPlacement(value: unknown): value is WindowPlacement {
	if (!value || typeof value !== "object") return false;
	const p = value as Partial<WindowPlacement>;
	return (
		typeof p.x === "number" &&
		typeof p.y === "number" &&
		typeof p.width === "number" &&
		typeof p.height === "number"
	);
}

function isNotFound(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code: unknown }).code === "ENOENT"
	);
}
