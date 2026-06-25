/**
 * Privileged profile IPC (Collab-C6) — the dashboard-only surface for reading +
 * editing the local user's self-asserted display profile (`Profile/v1`). Settings
 * → Identity drives these; sandboxed apps reach the same data through the
 * capability-gated `roster` broker service instead.
 *
 * Signing happens in the main process (the sovereign secret never crosses IPC);
 * these handlers just ferry `{displayName, avatarRef}` to `writeSelfProfile` and
 * shape the result for the renderer. No vault → a benign empty profile (the
 * Settings surface renders disabled), never a throw.
 */

import { ipcMain } from "electron";
import { fingerprintOf, readSelfProfile, writeSelfProfile } from "../collab/profile-store";
import { getActiveVaultSession } from "../vault/session";

export type ProfileView = {
	pubkey: string;
	fingerprint: string;
	displayName: string;
	avatarRef: string | null;
};

const EMPTY: ProfileView = { pubkey: "", fingerprint: "", displayName: "", avatarRef: null };

function shape(profile: {
	pubkey: string;
	displayName: string;
	avatarRef: string | null;
}): ProfileView {
	return {
		pubkey: profile.pubkey,
		fingerprint: profile.pubkey ? fingerprintOf(profile.pubkey) : "",
		displayName: profile.displayName,
		avatarRef: profile.avatarRef,
	};
}

export function registerProfileHandlers(): () => void {
	ipcMain.handle("profile:get", async (): Promise<ProfileView> => {
		const session = getActiveVaultSession();
		if (!session) return EMPTY;
		return shape(await readSelfProfile(session));
	});

	ipcMain.handle(
		"profile:set",
		async (_event, args: { displayName?: unknown; avatarRef?: unknown }): Promise<ProfileView> => {
			const session = getActiveVaultSession();
			if (!session) return EMPTY;
			const displayName = typeof args?.displayName === "string" ? args.displayName : "";
			const avatarRef = typeof args?.avatarRef === "string" ? args.avatarRef : null;
			return shape(await writeSelfProfile(session, { displayName, avatarRef }));
		},
	);

	return () => {
		ipcMain.removeHandler("profile:get");
		ipcMain.removeHandler("profile:set");
	};
}
