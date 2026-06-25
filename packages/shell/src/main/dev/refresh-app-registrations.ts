/**
 * Dev-only: re-apply an installed app's manifest registrations from its
 * already-installed bundle (7.6 — hot-reload dev-mode runtime
 * registration). No uninstall/reinstall, no shell restart: edit
 * `apps/<app>/manifest.json`'s `registrations`, call this, and the
 * running shell's IntentsBus reflects it on the next dispatch.
 *
 * Mirrors `seed-demo-apps.ts`'s active-session → registry/ledger →
 * `AppInstaller` wiring; the actual work is the pure
 * `AppInstaller.refreshRegistrations` (unit-tested there).
 */

import { AppInstaller, type RefreshResult } from "../apps/installer";
import { getActiveShortcutRegistry } from "../shortcuts/active-registry";
import { getActiveVaultSession } from "../vault/session";

export async function refreshAppRegistrations(appId: string): Promise<RefreshResult> {
	if (typeof appId !== "string" || appId.length === 0) {
		return { ok: false, reason: "refreshAppRegistrations: appId must be a non-empty string" };
	}
	const session = getActiveVaultSession();
	if (!session) {
		return { ok: false, reason: "refreshAppRegistrations: no active vault session" };
	}
	const registry = await session.dataStores.open("registry");
	const ledger = await session.capabilityLedger();
	const shortcutRegistry = getActiveShortcutRegistry();
	const installer = new AppInstaller(
		session.vaultPath,
		registry,
		ledger,
		shortcutRegistry ?? undefined,
	);
	return installer.refreshRegistrations(appId);
}
