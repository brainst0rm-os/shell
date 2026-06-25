/**
 * Type surface for the Web Browser app.
 *
 * Browser-1 (this iteration) ships the contracts + the chrome-only /
 * shell-engine split keystone:
 *   - `brainstorm/BrowsingSession/v1` (ephemeral tab/history model)
 *   - the `WebView` host-service wire contract (methods + metadata events +
 *     the `web.browse` / `web.capture` capabilities)
 *
 * The captured-page artifact is the shared `brainstorm/Bookmark/v1`
 * (OQ-RX-5: `WebPage/v1` retired) — owned by the Bookmarks types, not here.
 *
 * Later iterations land per §Web browser:
 *   - Browser-2 `WebView` host service (partitioned `WebContentsView`)
 *   - Browser-3 tabbed chrome (URL bar, nav, find, tab strip)
 *   - Browser-5 reader mode + `web.capture` → `Bookmark/v1`
 */

export * from "./browsing-session";
export * from "./web-view";
