/**
 * Decides the backing color of a tab's `WebContentsView` across the
 * empty-surface → real-page lifecycle, isolated from Electron so the
 * bleed-through race is testable.
 *
 * The race: a tab opens on the new-tab empty surface, the theme/wallpaper
 * color resolves asynchronously, and the user navigates to a real page. If the
 * theme color lands AFTER the navigation has started but BEFORE it commits,
 * `webContents.getURL()` still reports the uncommitted `about:blank`, so a
 * URL-only empty-surface check re-paints the theme color UNDER the page — it
 * then bleeds through any site with a transparent body (LinkedIn's hero renders
 * dark text expecting white, becoming unreadable on a dark theme). Gating on a
 * "has a real navigation started" flag, set the instant navigation begins,
 * closes the window regardless of event ordering.
 */
export const WEB_VIEW_DEFAULT_BACKGROUND = "#ffffff";

export class WebViewBackgroundController {
	private themeBackground: string | null = null;
	private leftEmptySurface = false;
	private color: string = WEB_VIEW_DEFAULT_BACKGROUND;

	/** The color the view should currently paint. */
	get backgroundColor(): string {
		return this.color;
	}

	/**
	 * The theme/wallpaper color resolved (async). Applies ONLY while the view
	 * is still on the empty surface — never once a real navigation has begun.
	 */
	onThemeResolved(color: string | null): void {
		this.themeBackground = color;
		if (color && !this.leftEmptySurface) this.color = color;
	}

	/**
	 * A main-frame navigation STARTED (pre-commit). `about:blank` is the empty
	 * surface (new tab) and gets the theme color; any real URL gets the
	 * web-default white and latches the view off the empty surface.
	 */
	onNavigationStart(url: string): void {
		const toEmptySurface = url === "about:blank";
		this.leftEmptySurface = !toEmptySurface;
		this.color =
			toEmptySurface && this.themeBackground ? this.themeBackground : WEB_VIEW_DEFAULT_BACKGROUND;
	}
}
