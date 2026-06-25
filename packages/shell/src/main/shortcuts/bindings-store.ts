/**
 * Shortcut bindings persistence per docs/shell/24-keyboard-shortcuts.md
 * §Shortcut bindings as a personal entity:
 *
 *   User customizations are stored as a `brainstorm/ShortcutBindings/v1`
 *   entity, scope `user` (personal-by-default).
 *
 * Stage 6 lands the shape and the file-backed store. **Stage 9 migrates it
 * to an entity** when the entities service comes online — same JSON shape,
 * so the migration is a one-shot read-and-store. For now the data lives at
 * `<vault>/shell/shortcut-bindings.json`.
 *
 *   {
 *     "version": 1,
 *     "overrides": [
 *       { "id": "shell/launcher", "chord": "CmdOrCtrl+P" },
 *       { "id": "io.example.editor/format-bold", "chord": null }
 *     ]
 *   }
 *
 * Pure I/O — fully testable under Bun.
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const BINDINGS_FILENAME = "shortcut-bindings.json";
const FORMAT_VERSION = 1;

export type BindingOverride = {
	id: string;
	chord: string | null;
};

export type BindingsFile = {
	version: typeof FORMAT_VERSION;
	overrides: BindingOverride[];
};

const EMPTY: BindingsFile = { version: FORMAT_VERSION, overrides: [] };

export function bindingsPath(vaultPath: string): string {
	return join(vaultPath, "shell", BINDINGS_FILENAME);
}

export async function readBindings(vaultPath: string): Promise<BindingsFile> {
	try {
		const raw = await readFile(bindingsPath(vaultPath), "utf8");
		const parsed = JSON.parse(raw) as Partial<BindingsFile>;
		if (!parsed || parsed.version !== FORMAT_VERSION || !Array.isArray(parsed.overrides)) {
			return cloneEmpty();
		}
		const overrides = parsed.overrides.filter(isOverride);
		return { version: FORMAT_VERSION, overrides };
	} catch (error) {
		if (isNotFound(error)) return cloneEmpty();
		console.warn("[brainstorm] shortcut-bindings.json read failed; treating as empty:", error);
		return cloneEmpty();
	}
}

export async function writeBindings(
	vaultPath: string,
	overrides: ReadonlyArray<BindingOverride>,
): Promise<void> {
	const path = bindingsPath(vaultPath);
	await mkdir(dirname(path), { recursive: true });
	const file: BindingsFile = {
		version: FORMAT_VERSION,
		overrides: [...overrides],
	};
	await writeFile(path, `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

export async function clearBindings(vaultPath: string): Promise<void> {
	await rm(bindingsPath(vaultPath), { force: true });
}

function cloneEmpty(): BindingsFile {
	return { ...EMPTY, overrides: [] };
}

function isOverride(value: unknown): value is BindingOverride {
	if (!value || typeof value !== "object") return false;
	const o = value as Partial<BindingOverride>;
	if (typeof o.id !== "string" || o.id.length === 0) return false;
	if (o.chord !== null && typeof o.chord !== "string") return false;
	return true;
}

function isNotFound(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code: unknown }).code === "ENOENT"
	);
}
