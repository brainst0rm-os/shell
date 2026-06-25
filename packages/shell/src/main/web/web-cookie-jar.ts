/**
 * Browser-10 — the persistent web cookie jar's runtime (the Electron glue for
 * the encrypted `cookies.db` store).
 *
 * The Browser's normal tabs share one in-memory Chromium session (see
 * {@link PERSISTENT_WEB_PARTITION}). Chromium itself persists nothing for an
 * in-memory partition, so this jar IS the persistence layer: on vault open it
 * re-injects the saved cookies into that session, and it mirrors every live
 * cookie change back into the encrypted store. Result: a login survives tab
 * close and app restart, while the bytes on disk are SQLCipher ciphertext
 * under the vault master key — exactly the at-rest bar the rest of the vault
 * meets — and are unreadable while the vault is locked.
 *
 * The Electron surface is isolated behind {@link CookieSessionPort} so the
 * mirror/hydrate logic is unit-testable with a fake session; the real port
 * ({@link electronCookieSessionPort}) is a thin adapter over an Electron
 * `Session`. Only NON-session cookies are persisted (Chromium drops session
 * cookies on close by definition — see `cookie-serde`).
 */

import type { Session } from "electron";
import { CookieJarRepository } from "../storage/cookie-jar-repo";
import {
	type CookieSetSpec,
	type ReadCookie,
	cookieKey,
	cookieToRecord,
	recordToSetSpec,
} from "./cookie-serde";

/** The Electron session operations the jar needs, abstracted so the jar logic
 *  stays testable without an Electron `Session`. */
export interface CookieSessionPort {
	/** Inject one cookie into the live session (best-effort per cookie). */
	setCookie(spec: CookieSetSpec): Promise<void>;
	/** Drop every cookie from the live session (vault switch / clear data). */
	clearCookies(): Promise<void>;
	/** Subscribe to live cookie changes; returns an unsubscribe fn. `removed`
	 *  marks a deletion (an overwrite fires removed-then-added). */
	onChanged(listener: (cookie: ReadCookie, removed: boolean) => void): () => void;
}

export class WebCookieJar {
	private unsubscribe: (() => void) | null = null;
	private disposed = false;

	constructor(
		private readonly repo: CookieJarRepository,
		private readonly session: CookieSessionPort,
		private readonly now: () => number = () => Date.now(),
	) {}

	/** Re-inject the stored cookies into the live session and start mirroring
	 *  live changes back. Expired cookies are pruned first so a stale jar isn't
	 *  resurrected. */
	async hydrate(): Promise<void> {
		this.repo.deleteExpired(Math.floor(this.now() / 1000));
		const records = this.repo.listAll();
		await Promise.all(
			records.map((record) =>
				this.session.setCookie(recordToSetSpec(record)).catch(() => {
					// A single rejected cookie (malformed host, etc.) must not abort
					// hydration of the rest.
				}),
			),
		);
		this.unsubscribe = this.session.onChanged((cookie, removed) => this.onChanged(cookie, removed));
	}

	private onChanged(cookie: ReadCookie, removed: boolean): void {
		if (this.disposed) return;
		if (removed) {
			const key = cookieKey(cookie);
			if (key) this.repo.delete(key);
			return;
		}
		const record = cookieToRecord(cookie);
		if (record) {
			this.repo.upsert(record);
			return;
		}
		// A cookie that turned non-persistable (e.g. now a session cookie) drops
		// any stored copy so we don't re-inject a dead one next open.
		const key = cookieKey(cookie);
		if (key) this.repo.delete(key);
	}

	/** Wipe the jar — the encrypted store AND the live session cookies
	 *  (Settings → Privacy → Clear browsing data). */
	async clear(): Promise<void> {
		if (!this.disposed) this.repo.clear();
		await this.session.clearCookies();
	}

	/** Stop mirroring and clear the LIVE session so a different vault opened in
	 *  the same process doesn't inherit this vault's cookies. Deliberately does
	 *  NOT touch the DB (its DataStore is closed by the vault-session teardown,
	 *  and its rows must survive to restore this vault on reopen). */
	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		this.unsubscribe?.();
		this.unsubscribe = null;
		await this.session.clearCookies();
	}
}

/** The real Electron adapter. The page never reaches this — the jar lives
 *  entirely in the main process, keyed to the shell-managed session. */
export function electronCookieSessionPort(ses: Session): CookieSessionPort {
	type SetDetails = Parameters<Session["cookies"]["set"]>[0];
	return {
		// The enum values ARE Electron's sameSite strings; the cast bridges the
		// nominal enum type to Electron's literal-union param.
		setCookie: (spec) => ses.cookies.set(spec as unknown as SetDetails),
		clearCookies: () => ses.clearStorageData({ storages: ["cookies"] }),
		onChanged: (listener) => {
			const handler = (_event: unknown, cookie: ReadCookie, _cause: unknown, removed: boolean) =>
				listener(cookie, removed);
			ses.cookies.on("changed", handler as never);
			return () => ses.cookies.removeListener("changed", handler as never);
		},
	};
}

/** Build a jar over an Electron persistent session + the vault's cookie DB. */
export function createWebCookieJar(repo: CookieJarRepository, ses: Session): WebCookieJar {
	return new WebCookieJar(repo, electronCookieSessionPort(ses));
}

export { CookieJarRepository };
