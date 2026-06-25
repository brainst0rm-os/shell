import { homedir } from "node:os";
import { sep } from "node:path";

/**
 * Per §Vault portability:
 *
 *   File-level cloud sync (Dropbox, iCloud Drive, OneDrive, Google Drive) does
 *   not survive Yjs snapshot+tail files or SQLite WAL. The shell warns at vault
 *   creation if the chosen path looks like a synced cloud directory. The check
 *   is a UX guard, not a hard block — power users can override after ack.
 */

export type CloudService = "dropbox" | "icloud" | "onedrive" | "googledrive";

export type CloudSyncWarning = {
	service: CloudService;
	displayName: string;
	hint: string;
};

const HUMAN_NAME: Record<CloudService, string> = {
	dropbox: "Dropbox",
	icloud: "iCloud Drive",
	onedrive: "OneDrive",
	googledrive: "Google Drive",
};

const HINT: Record<CloudService, string> = {
	dropbox:
		"Dropbox does partial-file syncing that can corrupt SQLite WAL and Yjs snapshot+tail files.",
	icloud:
		"iCloud Drive evicts files unpredictably (Optimize Mac Storage). This breaks always-on database files.",
	onedrive:
		"OneDrive does partial-file syncing that can corrupt SQLite WAL and Yjs snapshot+tail files.",
	googledrive:
		"Google Drive's File Stream and Backup-and-Sync both perform partial-file syncing incompatible with database files.",
};

type Matcher = {
	service: CloudService;
	patterns: RegExp[];
};

function buildMatchers(home: string): Matcher[] {
	const h = home.replace(/[/\\]+$/, "");
	const escH = escapeForRegex(h);
	const s = escapeForRegex(sep);

	return [
		{
			service: "dropbox",
			patterns: [
				new RegExp(`^${escH}${s}Dropbox(${s}|$)`, "i"),
				new RegExp(`^${escH}${s}Dropbox \\([^)]+\\)(${s}|$)`, "i"),
				new RegExp(`${s}CloudStorage${s}Dropbox(${s}|$)`, "i"),
			],
		},
		{
			service: "icloud",
			patterns: [
				new RegExp(`^${escH}${s}Library${s}Mobile Documents${s}com~apple~CloudDocs(${s}|$)`, "i"),
				new RegExp(`${s}CloudStorage${s}iCloud Drive(${s}|$)`, "i"),
			],
		},
		{
			service: "onedrive",
			patterns: [
				new RegExp(`^${escH}${s}OneDrive(${s}|$)`, "i"),
				new RegExp(`^${escH}${s}OneDrive - [^${s}]+(${s}|$)`, "i"),
				new RegExp(`${s}CloudStorage${s}OneDrive(-[^${s}]+)?(${s}|$)`, "i"),
			],
		},
		{
			service: "googledrive",
			patterns: [
				new RegExp(`^${escH}${s}Google Drive(${s}|$)`, "i"),
				new RegExp(`${s}CloudStorage${s}GoogleDrive-[^${s}]+(${s}|$)`, "i"),
				new RegExp(`^${escH}${s}GoogleDrive(${s}|$)`, "i"),
			],
		},
	];
}

function escapeForRegex(input: string): string {
	return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function detectCloudSync(
	path: string,
	options?: { home?: string },
): CloudSyncWarning | null {
	if (!path) return null;
	const home = options?.home ?? homedir();
	const matchers = buildMatchers(home);
	for (const { service, patterns } of matchers) {
		for (const pattern of patterns) {
			if (pattern.test(path)) {
				return {
					service,
					displayName: HUMAN_NAME[service],
					hint: HINT[service],
				};
			}
		}
	}
	return null;
}
