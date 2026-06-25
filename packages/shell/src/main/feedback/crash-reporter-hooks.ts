/**
 * Feedback-2 — Electron-side hook installation.
 *
 * Split out from `crash-reporter-service.ts` so the service stays
 * Electron-free + unit-testable in isolation. This module wires
 * `process.on('uncaughtException')` / `process.on('unhandledRejection')`
 * on the main process + a per-webContents `render-process-gone` +
 * `unresponsive` listener via `app.on('web-contents-created', …)`.
 *
 * Each hook wraps the `service.capture(...)` call in `try/catch` so a
 * crash inside the crash reporter never re-enters the reporter. The
 * hook *fires* the capture as a fire-and-forget promise — by the time
 * the queue write completes we may already be in the death throes of
 * the renderer; we don't want to await the IO before re-throwing.
 */

import type { App, Event, RenderProcessGoneDetails, WebContents } from "electron";
import {
	CrashKind,
	crashKindFromRendererReason,
	rendererReasonFromElectron,
} from "./crash-payload";
import type { CrashReporterService } from "./crash-reporter-service";

/** Decoupled Electron `crashReporter` surface. The real module is
 *  `electron.crashReporter`; tests pass a stub. */
export type CrashReporterShim = {
	readonly start: (options: {
		readonly submitURL: string;
		readonly uploadToServer: boolean;
		readonly companyName?: string;
		readonly productName?: string;
		readonly ignoreSystemCrashHandler?: boolean;
	}) => void;
};

export type InstallCrashHooksOptions = {
	readonly service: CrashReporterService;
	/** Electron `app` (or compatible shim for tests). */
	readonly app: Pick<App, "on">;
	/** Electron `crashReporter`. Optional — when omitted, Crashpad isn't
	 *  initialized (useful in tests + headless paths). */
	readonly crashReporter?: CrashReporterShim;
	/** Per-webContents URL → app-id / route extraction. */
	readonly resolveSurface?: (wc: WebContents) => { appId?: string; routePath?: string };
};

export type CrashHookUninstaller = () => void;

/** Install every hook. Returns an uninstaller so tests can tear down
 *  cleanly; production never uninstalls. */
export function installCrashHooks(options: InstallCrashHooksOptions): CrashHookUninstaller {
	const { service, app, crashReporter, resolveSurface } = options;

	if (crashReporter) {
		try {
			crashReporter.start({
				submitURL: "",
				uploadToServer: false,
				ignoreSystemCrashHandler: false,
			});
		} catch (error) {
			console.warn(`[crash-hooks] crashReporter.start failed: ${(error as Error).message}`);
		}
	}

	const uncaughtListener = (error: Error) => {
		fireAndForget(
			service.capture({
				kind: CrashKind.UncaughtException,
				message: error.message || String(error),
				...(error.stack !== undefined ? { stack: error.stack } : {}),
			}),
		);
	};
	const unhandledListener = (reason: unknown) => {
		const error = reason instanceof Error ? reason : new Error(String(reason));
		fireAndForget(
			service.capture({
				kind: CrashKind.UnhandledRejection,
				message: error.message || "unhandled rejection",
				...(error.stack !== undefined ? { stack: error.stack } : {}),
			}),
		);
	};

	process.on("uncaughtException", uncaughtListener);
	process.on("unhandledRejection", unhandledListener);

	const onWebContentsCreated = (_event: Event, contents: WebContents) => {
		attachWebContents(contents, { service, resolveSurface });
	};
	app.on("web-contents-created", onWebContentsCreated);

	return () => {
		process.off("uncaughtException", uncaughtListener);
		process.off("unhandledRejection", unhandledListener);
		// Electron's app object doesn't expose .off in older builds; do a
		// best-effort removal via `removeListener`.
		const anyApp = app as unknown as { removeListener?: (...args: unknown[]) => void };
		anyApp.removeListener?.("web-contents-created", onWebContentsCreated);
	};
}

const attachedWebContents = new WeakSet<WebContents>();

function attachWebContents(
	wc: WebContents,
	options: {
		service: CrashReporterService;
		resolveSurface?: InstallCrashHooksOptions["resolveSurface"];
	},
): void {
	if (attachedWebContents.has(wc)) return;
	attachedWebContents.add(wc);
	const { service, resolveSurface } = options;

	wc.on("render-process-gone", (_e: unknown, details: RenderProcessGoneDetails) => {
		const reason = rendererReasonFromElectron(details.reason);
		const kind = crashKindFromRendererReason(reason);
		const surface = safeResolveSurface(wc, resolveSurface);
		fireAndForget(
			service.capture({
				kind,
				rendererReason: reason,
				exitCode: details.exitCode,
				message: `renderer ${reason} (exitCode=${details.exitCode})`,
				...(surface.appId !== undefined ? { appId: surface.appId } : {}),
				...(surface.routePath !== undefined ? { routePath: surface.routePath } : {}),
			}),
		);
	});

	wc.on("unresponsive", () => {
		const surface = safeResolveSurface(wc, resolveSurface);
		fireAndForget(
			service.capture({
				kind: CrashKind.UnresponsiveRenderer,
				message: "renderer became unresponsive",
				...(surface.appId !== undefined ? { appId: surface.appId } : {}),
				...(surface.routePath !== undefined ? { routePath: surface.routePath } : {}),
			}),
		);
	});
}

function safeResolveSurface(
	wc: WebContents,
	resolveSurface: InstallCrashHooksOptions["resolveSurface"],
): { appId?: string; routePath?: string } {
	if (!resolveSurface) return defaultSurfaceFromUrl(wc);
	try {
		return resolveSurface(wc);
	} catch (_error) {
		return defaultSurfaceFromUrl(wc);
	}
}

function defaultSurfaceFromUrl(wc: WebContents): { appId?: string; routePath?: string } {
	let url = "";
	try {
		url = wc.getURL();
	} catch (_error) {
		return {};
	}
	const out: { appId?: string; routePath?: string } = {};
	const appMatch = url.match(/apps[/\\]([^/\\]+)[/\\]/);
	if (appMatch?.[1]) out.appId = appMatch[1];
	try {
		const parsed = new URL(url);
		if (parsed.pathname.length > 0) out.routePath = parsed.pathname;
	} catch (_error) {
		// URL parse failure → no routePath; not fatal.
	}
	return out;
}

function fireAndForget(promise: Promise<unknown>): void {
	promise.catch((error) => {
		console.warn(`[crash-hooks] capture failed: ${(error as Error).message}`);
	});
}
