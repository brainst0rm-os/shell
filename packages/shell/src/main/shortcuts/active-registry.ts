/**
 * Module-level accessor for the live shell `ShortcutRegistry`, mirroring
 * the `getActiveVaultSession` / `setActiveVaultSession` pattern. The shell
 * main owns the singleton; callers that need to mirror app shortcuts into
 * it at install / uninstall / dev-refresh time (the seeder, the IPC
 * uninstall handler, the dev-refresh helper) read through this accessor
 * instead of threading the instance through every closure.
 *
 * Iteration 6.10b — manifest → registry mirror.
 */

import type { ShortcutRegistry } from "./shortcut-registry";

let active: ShortcutRegistry | null = null;

export function setActiveShortcutRegistry(registry: ShortcutRegistry | null): void {
	active = registry;
}

export function getActiveShortcutRegistry(): ShortcutRegistry | null {
	return active;
}
