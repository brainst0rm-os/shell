/**
 * Welcome-2 template import — the live-session binding (9.3.5.V 7d), the twin
 * of `runWelcomeSeed`. Builds the privileged create+plant deps from the
 * session (shared `makeSeedEntityDeps`) + the per-template stamp store, and
 * runs `importTemplate` (which merges the manifest's entities under a parent
 * `List/v1` Collection). Idempotent per template per vault.
 *
 * The session is narrowed to `vaultPath` + `dataStores` so the in-process
 * pipeline test can drive it with a `DataStores` + the ydoc worker, no
 * keystore / master key needed.
 */

import type { VaultSession } from "../vault/session";
import { type ApplyDocUpdate, makeSeedEntityDeps } from "./seed-deps";
import { type TemplateImportResult, importTemplate } from "./seed-template";
import type { TemplateManifest } from "./template-codec";
import { readTemplateImportVersion, writeTemplateImportVersion } from "./template-import-store";
import { templateById } from "./template-registry";

export type RunTemplateImportDeps = {
	readonly session: Pick<VaultSession, "vaultPath" | "dataStores">;
	readonly manifest: TemplateManifest;
	readonly applyDocUpdate: ApplyDocUpdate;
	/** Injected clock for deterministic tests; defaults to `Date.now()`. */
	readonly now?: number;
};

export async function runTemplateImport(
	deps: RunTemplateImportDeps,
): Promise<TemplateImportResult> {
	const vaultPath = deps.session.vaultPath;
	const templateId = deps.manifest.id;
	const seedDeps = await makeSeedEntityDeps(deps.session, deps.applyDocUpdate);
	return importTemplate(deps.manifest, {
		now: deps.now ?? Date.now(),
		...seedDeps,
		readVersion: () => readTemplateImportVersion(vaultPath, templateId),
		writeVersion: (version) => writeTemplateImportVersion(vaultPath, templateId, version),
	});
}

export type RunTemplateImportByIdDeps = {
	readonly session: Pick<VaultSession, "vaultPath" | "dataStores">;
	/** A registry template id (see `template-registry.ts`). */
	readonly templateId: string;
	readonly applyDocUpdate: ApplyDocUpdate;
	/** Injected clock for deterministic tests; defaults to `Date.now()`. */
	readonly now?: number;
};

/**
 * Resolve a registry template id, build its manifest, and import it. Returns
 * `null` for an unknown id (the IPC handler fail-closes on this — it never
 * builds an arbitrary manifest from caller input). The manifest is built with
 * the SAME `now` passed to the import so `now`-derived fields (journal entry
 * dates, timestamps) stay consistent.
 */
export async function runTemplateImportById(
	deps: RunTemplateImportByIdDeps,
): Promise<TemplateImportResult | null> {
	const entry = templateById(deps.templateId);
	if (!entry) return null;
	const now = deps.now ?? Date.now();
	return runTemplateImport({
		session: deps.session,
		manifest: entry.build(now),
		applyDocUpdate: deps.applyDocUpdate,
		now,
	});
}
