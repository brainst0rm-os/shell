/**
 * Welcome-2 IPC handlers (9.3.5.V 7d) — privileged, dashboard-only. Lets the
 * first-launch template gallery import a bundled vault template into the
 * active vault by id.
 *
 * Security posture: a direct ipcMain channel (the dashboard renderer talks to
 * the main process directly, like `vaults:*` / `dashboard:*`), NOT an app
 * broker envelope. The only renderer-supplied input is the template id, which
 * is validated against the static `template-registry` — an unknown id
 * fail-closes (`runTemplateImportById` → null → `{ ok: false }`), so the
 * renderer can never make the main process build or import an arbitrary
 * manifest. The import itself only ever creates rows in the template's own id
 * namespace under a removable parent Collection (see `importTemplate`).
 */

import { ipcMain } from "electron";
import { getActiveVaultSession } from "../vault/session";
import { runTemplateImportById } from "../welcome/run-template-import";
import type { ApplyDocUpdate } from "../welcome/seed-deps";
import type { TemplateImportResult } from "../welcome/seed-template";
import { TEMPLATE_REGISTRY } from "../welcome/template-registry";

export const WELCOME_IMPORT_TEMPLATE_CHANNEL = "welcome:import-template";
export const WELCOME_LIST_TEMPLATES_CHANNEL = "welcome:list-templates";

export type WelcomeImportTemplateResult =
	| { ok: true; result: TemplateImportResult }
	| { ok: false; reason: string };

/** Gallery-facing projection of a registry entry — id + display metadata only.
 *  The `build(now)` authoring fn is deliberately dropped: it's a main-process
 *  closure that has no meaning across IPC, and the gallery never needs it. */
export type WelcomeTemplateSummary = {
	readonly id: string;
	readonly name: string;
	readonly description: string;
};

/** The bundled templates the first-launch gallery offers, in registry order.
 *  Pure (no electron / session) so it unit-tests directly. */
export function listTemplateSummaries(): WelcomeTemplateSummary[] {
	return TEMPLATE_REGISTRY.map(({ id, name, description }) => ({ id, name, description }));
}

export type WelcomeHandlersOptions = {
	/** Build a ydoc-plant fn BOUND to a specific vault path (from the broker's
	 *  ydoc service, mirroring the welcome-seed binding in `main/index.ts`). The
	 *  handler binds it to the SAME session it imports into, so a vault switch
	 *  mid-import can't make `createEntity` (session-bound) and `plantBody` (this
	 *  fn) target different vaults — both ride one `vaultPath`. */
	readonly makeApplyDocUpdate: (vaultPath: string) => ApplyDocUpdate;
	/** Fan out the vault-entities staleness signal so open apps re-query and
	 *  surface the imported content without a reopen. */
	readonly broadcastVaultEntitiesStale: () => void;
};

export function registerWelcomeHandlers(options: WelcomeHandlersOptions): void {
	ipcMain.handle(WELCOME_LIST_TEMPLATES_CHANNEL, (): WelcomeTemplateSummary[] =>
		listTemplateSummaries(),
	);
	ipcMain.handle(
		WELCOME_IMPORT_TEMPLATE_CHANNEL,
		async (_event, templateId: unknown): Promise<WelcomeImportTemplateResult> => {
			const session = getActiveVaultSession();
			if (!session) return { ok: false, reason: "no active vault session" };
			const id = typeof templateId === "string" ? templateId : "";
			const result = await runTemplateImportById({
				session,
				templateId: id,
				applyDocUpdate: options.makeApplyDocUpdate(session.vaultPath),
			});
			if (!result) return { ok: false, reason: `unknown template: ${id}` };
			options.broadcastVaultEntitiesStale();
			return { ok: true, result };
		},
	);
}
