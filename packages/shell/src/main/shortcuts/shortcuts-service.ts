/**
 * Broker service handler for `shortcuts` (6.10c) — runtime-registered
 * (dynamic) shortcuts + active-scope reporting from sandboxed app
 * renderers into the shell-side `ShortcutRegistry`.
 *
 * Methods (all capability-gated by `shortcuts.register`, default-granted
 * at install per §Capabilities):
 *
 *   - register({ additions })         → void
 *       Add or replace dynamic shortcuts for the calling app. App-scoped
 *       ids in `additions` are namespaced under `app/<appId>/<id>`. A
 *       dynamic binding with the same id as a static manifest entry
 *       shadows the static one (last-write-wins).
 *
 *   - unregister({ ids })             → void
 *       Remove specific dynamic shortcuts by app-scoped id. Unknown ids
 *       are silent no-ops (idempotent — safe to call in a teardown
 *       `finally`).
 *
 *   - setActiveScope({ scope })       → void
 *       Report the app's currently-active scope (e.g. "editor",
 *       "selection") so the cheatsheet aggregator can filter narrow-
 *       scoped bindings. `null` clears.
 *
 * The broker stamps `envelope.app` so the caller can't impersonate
 * another app. Cross-app writes are structurally impossible — the
 * handler keys every mutation off `envelope.app`. Throws `Invalid` on
 * malformed args / unknown methods, `Unavailable` when no registry is
 * wired (shouldn't happen — the broker only registers this service
 * after the registry exists).
 */

import type { ServiceHandler } from "../../ipc/broker";
import type { Envelope } from "../../ipc/envelope";
import { ServiceErrorName, serviceError } from "../services/errors";
import type { DynamicShortcutDeclaration, ShortcutRegistry } from "./shortcut-registry";

export type ShortcutsServiceOptions = {
	getRegistry: () => ShortcutRegistry | null;
};

function invalid(message: string): Error {
	return serviceError(ServiceErrorName.Invalid, message);
}

function unavailable(message: string): Error {
	return serviceError(ServiceErrorName.Unavailable, message);
}

function requireRegistry(options: ShortcutsServiceOptions): ShortcutRegistry {
	const registry = options.getRegistry();
	if (!registry) throw unavailable("shortcuts: registry not initialized");
	return registry;
}

function asObject(arg: unknown, method: string): Record<string, unknown> {
	if (!arg || typeof arg !== "object" || Array.isArray(arg)) {
		throw invalid(`shortcuts.${method}: argument must be an object`);
	}
	return arg as Record<string, unknown>;
}

function parseAdditions(value: unknown): DynamicShortcutDeclaration[] {
	if (!Array.isArray(value)) {
		throw invalid("shortcuts.register: additions must be an array");
	}
	const out: DynamicShortcutDeclaration[] = [];
	for (const [i, raw] of value.entries()) {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
			throw invalid(`shortcuts.register: additions[${i}] must be an object`);
		}
		const s = raw as Record<string, unknown>;
		if (typeof s.id !== "string" || s.id.length === 0) {
			throw invalid(`shortcuts.register: additions[${i}].id required`);
		}
		// App-scoped ids are relative — slashes would let an app smuggle a
		// shell-namespaced binding through. Reject defensively even though
		// the registry would namespace it under `<appId>/...` anyway.
		if (s.id.includes("/")) {
			throw invalid(`shortcuts.register: additions[${i}].id must not contain "/"`);
		}
		if (typeof s.default !== "string" || s.default.length === 0) {
			throw invalid(`shortcuts.register: additions[${i}].default required`);
		}
		if (typeof s.label !== "string" || s.label.length === 0) {
			throw invalid(`shortcuts.register: additions[${i}].label required`);
		}
		if (s.scope !== undefined && typeof s.scope !== "string") {
			throw invalid(`shortcuts.register: additions[${i}].scope must be a string`);
		}
		if (s.shadowsShell !== undefined && typeof s.shadowsShell !== "boolean") {
			throw invalid(`shortcuts.register: additions[${i}].shadowsShell must be a boolean`);
		}
		const decl: DynamicShortcutDeclaration = {
			id: s.id,
			default: s.default,
			label: s.label,
			...(s.scope !== undefined ? { scope: s.scope as string } : {}),
			...(s.shadowsShell === true ? { shadowsShell: true } : {}),
		};
		out.push(decl);
	}
	return out;
}

function parseIds(value: unknown): string[] {
	if (!Array.isArray(value)) {
		throw invalid("shortcuts.unregister: ids must be an array");
	}
	const out: string[] = [];
	for (const [i, raw] of value.entries()) {
		if (typeof raw !== "string" || raw.length === 0) {
			throw invalid(`shortcuts.unregister: ids[${i}] must be a non-empty string`);
		}
		if (raw.includes("/")) {
			throw invalid(`shortcuts.unregister: ids[${i}] must not contain "/"`);
		}
		out.push(raw);
	}
	return out;
}

export function makeShortcutsServiceHandler(options: ShortcutsServiceOptions): ServiceHandler {
	return async (envelope: Envelope): Promise<unknown> => {
		const appId = envelope.app;
		if (typeof appId !== "string" || appId.length === 0) {
			throw invalid("shortcuts: envelope missing appId");
		}
		switch (envelope.method) {
			case "register": {
				const arg = asObject(envelope.args[0], "register");
				const additions = parseAdditions(arg.additions);
				const registry = requireRegistry(options);
				registry.registerAppDynamic(appId, additions);
				return undefined;
			}
			case "unregister": {
				const arg = asObject(envelope.args[0], "unregister");
				const ids = parseIds(arg.ids);
				const registry = requireRegistry(options);
				registry.unregisterAppDynamic(appId, ids);
				return undefined;
			}
			case "setActiveScope": {
				const arg = asObject(envelope.args[0], "setActiveScope");
				if (arg.scope !== null && typeof arg.scope !== "string") {
					throw invalid("shortcuts.setActiveScope: scope must be a string or null");
				}
				if (typeof arg.scope === "string" && arg.scope.length === 0) {
					throw invalid("shortcuts.setActiveScope: scope must be non-empty or null");
				}
				const registry = requireRegistry(options);
				registry.setActiveScope(appId, arg.scope as string | null);
				return undefined;
			}
			default:
				throw invalid(`unknown shortcuts method: ${envelope.method}`);
		}
	};
}
