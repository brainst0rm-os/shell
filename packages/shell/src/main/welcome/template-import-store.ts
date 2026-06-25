/**
 * Welcome-2 — per-vault "templates already imported" stamp. Holds a
 * `{ [templateId]: version }` map at `<vault>/shell/template-imports.json`
 * (same `<vault>/shell/<file>` convention as `welcome-seed.json` /
 * `network-settings.json`), so each bundled template imports at most once per
 * vault and a re-import is a no-op. Per-template (not a single version) so
 * different templates import independently.
 *
 * Pure I/O, never throws — a missing / corrupt file (or an unknown template
 * id) reads as version `0` ("not imported"), the safe direction (at worst the
 * import runs again and `importTemplate` overwrites in place by stable id).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const TEMPLATE_IMPORTS_FILENAME = "template-imports.json";

/** `<vault>/shell/template-imports.json`. */
export function templateImportsStampPath(vaultPath: string): string {
	return join(vaultPath, "shell", TEMPLATE_IMPORTS_FILENAME);
}

async function readMap(vaultPath: string): Promise<Record<string, number>> {
	try {
		const raw = await readFile(templateImportsStampPath(vaultPath), "utf8");
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		const out: Record<string, number> = {};
		for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
			if (typeof v === "number" && Number.isInteger(v) && v >= 0) out[k] = v;
		}
		return out;
	} catch (error) {
		if (!isNotFound(error)) {
			console.warn("[brainstorm] template-imports.json read failed; treating as none:", error);
		}
		return {};
	}
}

/** The last-imported version for `templateId` in this vault, or `0`. */
export async function readTemplateImportVersion(
	vaultPath: string,
	templateId: string,
): Promise<number> {
	return (await readMap(vaultPath))[templateId] ?? 0;
}

/** Record `templateId` imported at `version`, merging into the existing map
 *  (other templates' stamps preserved). */
export async function writeTemplateImportVersion(
	vaultPath: string,
	templateId: string,
	version: number,
): Promise<void> {
	const map = await readMap(vaultPath);
	map[templateId] = version;
	const path = templateImportsStampPath(vaultPath);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(map, null, 2)}\n`, "utf8");
}

function isNotFound(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code: unknown }).code === "ENOENT"
	);
}
