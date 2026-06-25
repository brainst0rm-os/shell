/**
 * Broker service handler for `icons` (B11.14) — the capability-gated,
 * app-reachable face of the vault image-icon store, so an app's icon picker
 * can upload a custom image ("custom emoji") and list previously-uploaded
 * ones. The dashboard already reaches the store via `icons:*` IPC; this is
 * the same store behind the broker for sandboxed apps.
 *
 * Methods (object args + base64 bytes on the wire, mirroring the covers
 * service):
 *   - uploadBytes({ name, bytesBase64 }) → IconUploadResult   (cap icons.write)
 *   - list()                             → IconEntry[]        (cap icons.read)
 *   - delete({ url })                    → boolean            (cap icons.write)
 *
 * Capability gating happens in the broker via the envelope's `caps`. This is
 * the pure half — it validates args (strings · base64 size cap) and delegates
 * to injected store ops, so it unit-tests without Electron / a vault. Throws
 * `Invalid` on malformed input / unknown method.
 */

import type { ServiceHandler } from "../../ipc/broker";
import type { Envelope } from "../../ipc/envelope";
import type { IconEntry, IconUploadResult } from "./icon-store";

export const ICONS_READ_CAP = "icons.read";
export const ICONS_WRITE_CAP = "icons.write";

/** Hard cap on the base64 upload payload (~6 MiB of raw bytes). Icons are
 *  small; the limit defends the store from a hostile multi-hundred-MB upload. */
export const MAX_ICON_BASE64_LEN = 8 * 1024 * 1024;

export type IconsServiceOptions = {
	uploadBytes: (name: string, bytesBase64: string) => Promise<IconUploadResult>;
	list: () => Promise<IconEntry[]>;
	deleteIcon: (url: string) => Promise<boolean>;
};

function invalid(message: string): Error {
	const err = new Error(message);
	err.name = "Invalid";
	return err;
}

function requireObjectArg(envelope: Envelope): Record<string, unknown> {
	const [arg] = envelope.args as [unknown];
	if (!arg || typeof arg !== "object" || Array.isArray(arg)) {
		throw invalid(`icons.${envelope.method}: argument must be an object`);
	}
	return arg as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw invalid(`icons: ${label} must be a non-empty string`);
	}
	return value;
}

export function makeIconsServiceHandler(options: IconsServiceOptions): ServiceHandler {
	return async (envelope: Envelope): Promise<unknown> => {
		switch (envelope.method) {
			case "uploadBytes": {
				const arg = requireObjectArg(envelope);
				const name = requireString(arg.name, "name");
				const bytesBase64 = requireString(arg.bytesBase64, "bytesBase64");
				if (bytesBase64.length > MAX_ICON_BASE64_LEN) {
					throw invalid("icons.uploadBytes: payload exceeds the size limit");
				}
				return options.uploadBytes(name, bytesBase64);
			}
			case "list":
				return options.list();
			case "delete": {
				const arg = requireObjectArg(envelope);
				return options.deleteIcon(requireString(arg.url, "url"));
			}
			default:
				throw invalid(`unknown icons method: ${envelope.method}`);
		}
	};
}
