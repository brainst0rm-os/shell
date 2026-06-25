/**
 * External-link routing for renderer webContents the shell owns (app tab
 * views, the dashboard). These surfaces load a local bundle and never
 * legitimately navigate away or spawn OS windows — a `window.open` /
 * `target="_blank"` anchor (a bookmark's source link, an editor bookmark
 * card) is always an "open this URL" request. Without a handler Electron's
 * default spawns a bare unmanaged BrowserWindow, bypassing the
 * open-resolution ladder entirely. Deny at the Electron boundary and
 * re-dispatch the URL through the IntentsBus instead, so the registered
 * in-vault opener (the Browser app for http/https) wins.
 */

const WEB_URL_PATTERN = /^https?:\/\//i;

/** Only web URLs re-enter the open ladder from a renderer link. Everything
 *  else (file:, javascript:, custom schemes) is dropped at this boundary —
 *  a renderer that genuinely needs another scheme dispatches `intent.open`
 *  through the SDK where the ladder's floor + consent rungs apply. */
export function isRoutableExternalUrl(url: string): boolean {
	return WEB_URL_PATTERN.test(url);
}

/** The minimal webContents surface the wiring needs. `setWindowOpenHandler`
 *  is optional so test fakes / narrowed handles without it still get the
 *  will-navigate guard. */
export type RoutableWebContents = {
	setWindowOpenHandler?(handler: (details: { url: string }) => { action: "deny" }): void;
	on(event: string, listener: (...args: unknown[]) => void): void;
};

export function wireExternalLinkRouting(
	wc: RoutableWebContents,
	routeUrl: (url: string) => void,
): void {
	wc.setWindowOpenHandler?.((details) => {
		if (isRoutableExternalUrl(details.url)) routeUrl(details.url);
		return { action: "deny" };
	});
	wc.on("will-navigate", (...args: unknown[]) => {
		const event = args[0] as { preventDefault?: () => void } | undefined;
		const url = args[1];
		event?.preventDefault?.();
		if (typeof url === "string" && isRoutableExternalUrl(url)) routeUrl(url);
	});
}
