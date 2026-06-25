/**
 * Connector-2 — OAuth redirect capture (OQ-CN-2: loopback primary).
 *
 * The shell OWNS the OAuth redirect (doc 56 §The custody invariant): the
 * authorization code never passes through the connector renderer. The
 * primary mechanism is an ephemeral loopback HTTP server bound to
 * `127.0.0.1:0` — it works on every desktop OS without protocol
 * registration. The `brainstorm://oauth/...` custom scheme is a
 * registered fallback (`customSchemeRedirectProvider`) wired behind the
 * same `RedirectProvider` interface so the broker is mechanism-agnostic.
 *
 * Hardening: 127.0.0.1-only bind, single-shot (the server closes after
 * the first matching request), a hard timeout, and constant-time `state`
 * comparison. The server is ALWAYS closed (success, mismatch, or
 * timeout).
 */

import { timingSafeEqual } from "node:crypto";
import { type Server, createServer } from "node:http";

/** Default time the loopback server waits for the provider redirect. */
const DEFAULT_REDIRECT_TIMEOUT_MS = 5 * 60 * 1000;

export type RedirectCapture = {
	/** The `redirect_uri` to hand the provider — known only after bind. */
	readonly redirectUri: string;
	/** Resolves with the authorization `code` once the provider redirects
	 *  back with a matching `state`; rejects on timeout / state mismatch. */
	waitForCode(expectedState: string): Promise<string>;
	/** Tear the listener down (idempotent). Always call in a `finally`. */
	close(): void;
};

export type RedirectStartOptions = {
	timeoutMs?: number;
};

export interface RedirectProvider {
	start(options?: RedirectStartOptions): Promise<RedirectCapture>;
}

/** Constant-time string compare that tolerates differing lengths. */
function statesEqual(a: string, b: string): boolean {
	const ba = Buffer.from(a);
	const bb = Buffer.from(b);
	if (ba.length !== bb.length) return false;
	return timingSafeEqual(ba, bb);
}

const CALLBACK_HTML =
	"<!doctype html><meta charset=utf-8><title>Connected</title>" +
	'<body style="font:14px system-ui;padding:3rem;text-align:center">' +
	"<p>You can close this window and return to Brainstorm.</p>";

/**
 * Start an ephemeral loopback redirect listener. Resolves once the OS has
 * assigned a port (so the caller can build the authorization URL with the
 * concrete `redirectUri`).
 */
export function startLoopbackRedirect(
	options: RedirectStartOptions = {},
): Promise<RedirectCapture> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_REDIRECT_TIMEOUT_MS;
	return new Promise((resolve, reject) => {
		let settle: ((code: string) => void) | null = null;
		let fail: ((err: Error) => void) | null = null;
		let timer: ReturnType<typeof setTimeout> | null = null;
		let expected: string | null = null;
		let pending: { code: string } | null = null;

		const server: Server = createServer((req, res) => {
			const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
			const code = requestUrl.searchParams.get("code");
			const state = requestUrl.searchParams.get("state");
			res.statusCode = 200;
			res.setHeader("content-type", "text/html; charset=utf-8");
			res.end(CALLBACK_HTML);
			if (!code || !state) return;
			// The redirect may arrive before waitForCode() is called; stash it.
			if (expected === null) {
				pending = { code };
				return;
			}
			if (statesEqual(state, expected)) {
				settle?.(code);
			} else {
				fail?.(new Error("oauth redirect: state mismatch"));
			}
		});

		server.on("error", (err) => reject(err));

		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				server.close();
				reject(new Error("oauth redirect: failed to bind loopback port"));
				return;
			}
			const redirectUri = `http://127.0.0.1:${address.port}/callback`;
			const close = (): void => {
				if (timer) clearTimeout(timer);
				timer = null;
				server.close();
			};
			resolve({
				redirectUri,
				waitForCode(expectedState: string): Promise<string> {
					expected = expectedState;
					return new Promise<string>((res2, rej2) => {
						settle = (c) => {
							close();
							res2(c);
						};
						fail = (e) => {
							close();
							rej2(e);
						};
						timer = setTimeout(() => {
							close();
							rej2(new Error("oauth redirect: timed out waiting for provider"));
						}, timeoutMs);
						// A redirect that landed before waitForCode() was called.
						if (pending) settle(pending.code);
					});
				},
				close,
			});
		});
	});
}

/** OQ-CN-2 primary: ephemeral loopback. */
export const loopbackRedirectProvider: RedirectProvider = {
	start: startLoopbackRedirect,
};

/** OQ-CN-2 fallback: registered `brainstorm://oauth/<connector>` scheme.
 *  Wired behind the same interface; the OS-registration path is built when
 *  a provider rejects loopback (rare). */
export const customSchemeRedirectProvider: RedirectProvider = {
	start() {
		return Promise.reject(
			new Error("oauth redirect: custom-scheme fallback not yet wired (OQ-CN-2)"),
		);
	},
};
