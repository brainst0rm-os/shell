/**
 * Broker service handler for `covers` (B7.2c) — the capability-gated,
 * app-reachable face of the cover content store.
 *
 * Methods:
 *   - uploadBytes({ name, bytesBase64 }) → { url, thumbUrl }
 *   - list()                            → CoverImageEntry[]
 *   - delete({ url })                   → boolean
 *
 * Capability gating happens in the broker via the envelope's `caps`
 * field; the SDK proxy declares `covers.write` (upload/delete) and
 * `covers.read` (list). Throws `Unavailable` when no vault session is
 * active; `Invalid` on malformed args, unknown methods, or a rejected
 * upload (bad type / empty / too large — surfaced via
 * `CoverUploadRejected`, whose `.name` is already `"Invalid"`).
 *
 * Thin on purpose: every byte of validation / dedup / path-traversal
 * posture lives in the shared `covers-handlers` store core, so the
 * dashboard ipcMain path and this broker path are byte-for-byte the
 * same audited code. Keeps the new app-reachable surface easy to review.
 */

import { extname } from "node:path";
import type { ServiceHandler } from "../../ipc/broker";
import type { Envelope } from "../../ipc/envelope";
import {
	type CoverImageEntry,
	type CoverUploadResult,
	coverSeal,
	deleteCoverByUrl,
	listCovers,
	uploadBytes,
} from "../ipc/covers-handlers";
import { getActiveVaultSession } from "../vault/session";

export type CoversServiceOptions = {
	/** Active vault path, or null when no session is open (→ Unavailable). */
	getVaultPath: () => string | null;
};

function invalid(message: string): Error {
	const err = new Error(message);
	err.name = "Invalid";
	return err;
}

function unavailable(message: string): Error {
	const err = new Error(message);
	err.name = "Unavailable";
	return err;
}

function requireVaultPath(options: CoversServiceOptions): string {
	const path = options.getVaultPath();
	if (!path) throw unavailable("covers: no active vault session");
	return path;
}

function requireUploadArg(envelope: Envelope): { name: string; bytesBase64: string } {
	const [arg] = envelope.args as [unknown];
	if (!arg || typeof arg !== "object" || Array.isArray(arg)) {
		throw invalid("covers.uploadBytes: argument must be an object");
	}
	const a = arg as Record<string, unknown>;
	if (typeof a.name !== "string" || a.name.length === 0) {
		throw invalid("covers.uploadBytes: name must be a non-empty string");
	}
	if (typeof a.bytesBase64 !== "string" || a.bytesBase64.length === 0) {
		throw invalid("covers.uploadBytes: bytesBase64 must be a non-empty string");
	}
	return { name: a.name, bytesBase64: a.bytesBase64 };
}

function requireUrlArg(envelope: Envelope): string {
	const [arg] = envelope.args as [unknown];
	if (!arg || typeof arg !== "object" || Array.isArray(arg)) {
		throw invalid("covers.delete: argument must be an object");
	}
	const url = (arg as Record<string, unknown>).url;
	if (typeof url !== "string" || url.length === 0) {
		throw invalid("covers.delete: url must be a non-empty string");
	}
	return url;
}

export function makeCoversServiceHandler(options: CoversServiceOptions): ServiceHandler {
	return async (envelope: Envelope): Promise<unknown> => {
		switch (envelope.method) {
			case "uploadBytes": {
				const vaultPath = requireVaultPath(options);
				const { name, bytesBase64 } = requireUploadArg(envelope);
				const bytes = Buffer.from(bytesBase64, "base64");
				// `uploadBytes` enforces ext allow-list + size ceiling + dedup
				// and throws `CoverUploadRejected` (name "Invalid") on reject.
				const session = getActiveVaultSession();
				const result: CoverUploadResult = await uploadBytes(
					vaultPath,
					bytes,
					extname(name).toLowerCase(),
					session ? coverSeal(session) : undefined,
				);
				return result;
			}
			case "list": {
				const vaultPath = requireVaultPath(options);
				const entries: CoverImageEntry[] = await listCovers(vaultPath);
				return entries;
			}
			case "delete": {
				const vaultPath = requireVaultPath(options);
				const url = requireUrlArg(envelope);
				return await deleteCoverByUrl(vaultPath, url);
			}
			default:
				throw invalid(`unknown covers method: ${envelope.method}`);
		}
	};
}
