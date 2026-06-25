import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { appConfigDir, registryPath } from "./paths";

const REGISTRY_VERSION = 1;
/**
 * The on-disk `vault.json.format` literal this shell mints + tolerates as
 * the current freeze (Stage 10.8). Renamed from `VAULT_FORMAT` in 10.8 so
 * the constant name reflects what the value is (a freeze version), while
 * the on-disk field name stays `format` for backward compatibility.
 *
 * Pre-freeze vaults (`< 1.0`) are refused by `assertVaultFormatNotPreFreeze`.
 * Same-major future-minor vaults (e.g. `1.5`) open via preserve-and-ignore.
 * Future-major vaults (e.g. `2.0`) are refused by `assertVaultFormatSupported`.
 */
const VAULT_FORMAT_VERSION = "1.0";

export type VaultEntry = {
	id: string;
	name: string;
	color: string;
	icon?: string;
	path: string;
	lastOpenedAt: number;
	format: string;
};

export type Registry = {
	version: number;
	vaults: VaultEntry[];
	defaultVaultId: string | null;
};

const EMPTY_REGISTRY: Registry = {
	version: REGISTRY_VERSION,
	vaults: [],
	defaultVaultId: null,
};

export async function readRegistry(): Promise<Registry> {
	try {
		const raw = await readFile(registryPath(), "utf8");
		const parsed = JSON.parse(raw) as unknown;
		return validate(parsed);
	} catch (error) {
		if (isNotFound(error)) {
			return structuredClone(EMPTY_REGISTRY);
		}
		console.warn("[vault] registry read failed; treating as empty:", error);
		return structuredClone(EMPTY_REGISTRY);
	}
}

export async function writeRegistry(registry: Registry): Promise<void> {
	await mkdir(appConfigDir(), { recursive: true });
	await writeFile(registryPath(), `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

/**
 * Best-effort salvage of vault `path` values from a possibly-corrupt
 * `registry.json` — the "known paths" half of doc 28's "Vault registry
 * corrupted" recovery (iteration 12.8). `readRegistry()` swallows a corrupt
 * file into an empty registry, which loses the paths the scanner wants as
 * direct candidates; this re-reads the raw file and extracts them.
 *
 * Two passes: a clean `JSON.parse` first (handles a structurally-valid but
 * schema-drifted registry), then a lenient regex over the raw text for the
 * truly-malformed case (a half-written file from a power loss). Read-only,
 * never throws — a missing file returns `[]`.
 */
export async function salvageRegistryPaths(): Promise<string[]> {
	const raw = await readFile(registryPath(), "utf8").catch(() => null);
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw) as { vaults?: unknown };
		if (Array.isArray(parsed.vaults)) {
			const paths = parsed.vaults
				.map((v) => (v && typeof v === "object" ? (v as { path?: unknown }).path : undefined))
				.filter((p): p is string => typeof p === "string");
			if (paths.length > 0) return [...new Set(paths)];
		}
	} catch {
		// Fall through to the lenient extraction below.
	}
	const out = new Set<string>();
	const pattern = /"path"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
	for (let match = pattern.exec(raw); match !== null; match = pattern.exec(raw)) {
		try {
			out.add(JSON.parse(`"${match[1]}"`) as string);
		} catch {
			// A path fragment that won't re-parse as a JSON string is skipped.
		}
	}
	return [...out];
}

function validate(parsed: unknown): Registry {
	if (!parsed || typeof parsed !== "object") return structuredClone(EMPTY_REGISTRY);
	const value = parsed as Partial<Registry>;
	const vaults = Array.isArray(value.vaults) ? value.vaults.filter(isVaultEntry) : [];
	return {
		version: typeof value.version === "number" ? value.version : REGISTRY_VERSION,
		vaults,
		defaultVaultId:
			typeof value.defaultVaultId === "string" && vaults.some((v) => v.id === value.defaultVaultId)
				? value.defaultVaultId
				: (vaults[0]?.id ?? null),
	};
}

function isVaultEntry(value: unknown): value is VaultEntry {
	if (!value || typeof value !== "object") return false;
	const v = value as Partial<VaultEntry>;
	return (
		typeof v.id === "string" &&
		typeof v.name === "string" &&
		typeof v.path === "string" &&
		typeof v.format === "string"
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

export { REGISTRY_VERSION, VAULT_FORMAT_VERSION };

// Re-export the path helper for symmetry with consumers that want to peek.
export { registryPath } from "./paths";

// Make dirname callable as a no-op alias for consumers that don't import it directly.
// (Kept here so that lower-level helpers in this file have all relevant utilities.)
export const _registryDir = dirname;
