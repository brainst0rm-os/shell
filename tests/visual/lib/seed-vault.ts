/**
 * Create + activate a vault inside the harness user-data-dir, then seed
 * the demo apps so each first-party app has something to render.
 *
 * Extracted from the perf harness's `ensureVaultAndSeed` so the visual spec
 * can call it once at the start of the run.
 */

import type { Page } from "@playwright/test";

type BrainstormDashboardApi = {
	vaults: {
		list: () => Promise<unknown[]>;
		create: (opts: { name: string; path: string }) => Promise<unknown>;
		activate: (id: string) => Promise<unknown>;
		session: () => Promise<unknown>;
	};
	dev: { seedDemoApps: () => Promise<unknown> };
};

export async function ensureVaultAndSeed(dashboard: Page, userDataDir: string): Promise<void> {
	await dashboard.evaluate(
		async ({ userDataDir }) => {
			const bs = (window as unknown as { brainstorm: BrainstormDashboardApi }).brainstorm;
			const list = (await bs.vaults.list()) as Array<{ id: string }>;
			let session = await bs.vaults.session();
			if (list.length === 0) {
				await bs.vaults.create({ name: "visual-fixture", path: `${userDataDir}/vault` });
				session = await bs.vaults.session();
			} else if (!session && list[0]) {
				await bs.vaults.activate(list[0].id);
				session = await bs.vaults.session();
			}
			if (!session) throw new Error("visual harness: no active vault after setup");
			await bs.dev.seedDemoApps();
		},
		{ userDataDir },
	);
	// The renderer's VaultProvider only refetches `current` when one of its
	// own callbacks fires. The imperative `bs.vaults.create` we just ran
	// happens outside the React tree, so the provider keeps showing
	// <Welcome />. Reloading the dashboard remounts the provider, which
	// then sees the active session and renders <Dashboard />.
	await dashboard.reload({ waitUntil: "domcontentloaded" });
	await dashboard.waitForSelector(".dashboard", { state: "visible", timeout: 30_000 });
}
