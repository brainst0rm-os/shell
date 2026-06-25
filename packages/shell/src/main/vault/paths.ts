import { homedir } from "node:os";
import { join } from "node:path";
import { app } from "electron";

/**
 * Returns the OS-standard app-config directory where the vault registry lives.
 *
 * - macOS:   ~/Library/Application Support/Brainstorm
 * - Windows: %APPDATA%\Brainstorm
 * - Linux:   $XDG_CONFIG_HOME/brainstorm (or ~/.config/brainstorm)
 *
 * This is the only state Brainstorm keeps outside of vaults themselves.
 * (Per.)
 */
export function appConfigDir(): string {
	return app.getPath("userData");
}

export function registryPath(): string {
	return join(appConfigDir(), "registry.json");
}

/**
 * The default location offered when creating a new vault. Per OQ-111 leaning:
 * - macOS / Windows: ~/Documents/Brainstorm/<name>
 * - Linux: ~/Brainstorm/<name>
 */
export function defaultVaultRoot(): string {
	if (process.platform === "linux") {
		return join(homedir(), "Brainstorm");
	}
	return join(homedir(), "Documents", "Brainstorm");
}

export function defaultVaultPath(name: string): string {
	return join(defaultVaultRoot(), sanitizeFolderName(name));
}

function sanitizeFolderName(name: string): string {
	return name.replace(/[/\\?%*:|"<>]/g, "-").trim() || "Vault";
}
