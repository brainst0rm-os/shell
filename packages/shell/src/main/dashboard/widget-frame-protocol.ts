/**
 * `bswidget://` protocol (Stage 7.3b) — serves a widget app's installed bundle
 * to its dashboard `<iframe>` from its OWN origin (`bswidget://<appId>/…`).
 *
 * Why a scheme and not `file://`: the dashboard renderer is `http://localhost`
 * in dev and `file://` in a packaged build. An `http://` page may NOT embed a
 * `file://` iframe ("Not allowed to load local resource"), so file:// breaks dev
 * entirely; and in prod a `file://` iframe is SAME-origin with the `file://`
 * dashboard, so `sandbox="allow-same-origin"` would let it reach the parent. A
 * registered privileged scheme fixes both: it loads from any renderer origin AND
 * is a DISTINCT origin from the dashboard (localhost / file://), so the sandbox's
 * `allow-same-origin` lets the bundle load its ES modules without granting any
 * reach into the shell.
 *
 * Trust: the served files are installed app code (first-party in v1), already on
 * disk and readable by the shell. The iframe still has no preload and no ambient
 * authority — its data calls round-trip through the postMessage widget-bridge,
 * capability-checked per app in the main process.
 */

import { readFile } from "node:fs/promises";
import { basename, dirname, join, normalize, sep } from "node:path";
import { protocol } from "electron";
import { resolveEntryPathSync } from "./widget-surface-factory";

export const WIDGET_FRAME_SCHEME = "bswidget";

/** Privilege descriptor for `protocol.registerSchemesAsPrivileged` — call at
 *  module load, BEFORE `app.whenReady`. `standard` gives a real origin (so the
 *  iframe is cross-origin to the dashboard) + lets relative module/asset URLs
 *  resolve; `secure` marks it a secure context (modules + crypto). */
export const WIDGET_FRAME_SCHEME_PRIVILEGE = {
	scheme: WIDGET_FRAME_SCHEME,
	privileges: { standard: true, secure: true, supportFetchAPI: true },
} as const;

/** The installed-app fields the protocol needs to locate + cache-bust a bundle. */
export type WidgetFrameAppRecord = { bundleDir: string; bundleSha256: string };

export type WidgetFrameProtocolDeps = {
	/** Resolve an installed app's active bundle, or null when it's gone / no
	 *  session. */
	getAppRecord: (appId: string) => Promise<WidgetFrameAppRecord | null>;
	/** Shared per-bundle entry-path cache (keyed by sha), reused with the bridge. */
	entryCache: Map<string, string>;
};

const MIME: Readonly<Record<string, string>> = {
	html: "text/html; charset=utf-8",
	js: "text/javascript; charset=utf-8",
	mjs: "text/javascript; charset=utf-8",
	css: "text/css; charset=utf-8",
	json: "application/json; charset=utf-8",
	map: "application/json; charset=utf-8",
	svg: "image/svg+xml",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	avif: "image/avif",
	ico: "image/x-icon",
	woff: "font/woff",
	woff2: "font/woff2",
	ttf: "font/ttf",
	wasm: "application/wasm",
};

function contentType(path: string): string {
	const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
	return MIME[ext] ?? "application/octet-stream";
}

/** Pure request handler (Electron-free) — maps a `bswidget://<appId>/<path>`
 *  request to a file inside that app's bundle. 404 for an unknown app, 403 for a
 *  path that escapes the bundle dir, 404 for a missing file. */
export async function serveWidgetFrameRequest(
	requestUrl: string,
	deps: WidgetFrameProtocolDeps,
): Promise<Response> {
	const url = new URL(requestUrl);
	const appId = url.host;
	if (!appId) return new Response(null, { status: 404 });
	const record = await deps.getAppRecord(appId);
	if (!record) return new Response(null, { status: 404 });

	// The bundle's entry can live in a subdir (e.g. `dist/index.html`), and its
	// HTML references assets relative to THAT dir (`/assets/…`). So the served
	// origin root is the entry's directory, not the bundle root — both the entry
	// and its assets resolve under it.
	const entry = resolveEntryPathSync(record.bundleDir, record.bundleSha256, deps.entryCache);
	const root = normalize(join(record.bundleDir, dirname(entry)));
	const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
	const target = normalize(join(root, rel === "" ? basename(entry) : rel));
	// Traversal guard — the resolved path must stay inside the bundle dir.
	if (target !== root && !target.startsWith(root + sep)) {
		return new Response(null, { status: 403 });
	}
	try {
		const body = await readFile(target);
		return new Response(new Uint8Array(body), {
			status: 200,
			headers: { "content-type": contentType(target), "cache-control": "no-store" },
		});
	} catch {
		return new Response(null, { status: 404 });
	}
}

/** Register the `bswidget://` handler. Call once after `app.whenReady`. */
export function registerWidgetFrameProtocol(deps: WidgetFrameProtocolDeps): void {
	protocol.handle(WIDGET_FRAME_SCHEME, (request) => serveWidgetFrameRequest(request.url, deps));
}

/** Build the iframe `src` for a widget: `bswidget://<appId>/?v=<sha8>` (empty
 *  path → the bundle entry). The caller appends the `bs-widget` launch query. */
export function widgetFrameUrl(appId: string, bundleSha256: string): string {
	return `${WIDGET_FRAME_SCHEME}://${appId}/?v=${bundleSha256.slice(0, 8)}`;
}
