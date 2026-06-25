/**
 * Tab-identity favicon codec — how an app publishes its open object's icon
 * to the shell-drawn tab strip.
 *
 * The channel is the page favicon: the SDK's `publishTabIdentity` writes a
 * `<link rel="icon">`, Electron reports it via `page-favicon-updated`, and
 * the window-container forwards the URL to the strip renderer — the exact
 * twin of how `document.title` → `page-title-updated` labels the tab. No
 * new IPC surface.
 *
 * Both ends share this module: the SDK encodes a universal `Icon` into a
 * favicon URL here, and the shell recognises {@link TAB_ICON_NONE} as "no
 * icon" (removing a `<link>` doesn't re-fire the Electron event, so absence
 * must be an explicit value, not a missing one).
 *
 * Leaf-adjacent module: imports only `./icon`.
 */

import type { Icon } from "./icon";
import { IconKind } from "./icon";

/** Published when the open object has no usable icon. An empty SVG so the
 *  page's favicon slot stays valid; the shell maps it to `icon: null`. */
export const TAB_ICON_NONE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E";

const XML_ESCAPES: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&apos;",
};

function escapeXml(value: string): string {
	return value.replace(/[&<>"']/g, (ch) => XML_ESCAPES[ch] ?? ch);
}

/** Render emoji codepoint(s) as an SVG favicon data URL (the standard
 *  emoji-favicon technique — SVG `<text>` rasterises with the system
 *  colour-emoji font inside an `<img>`). */
export function emojiFaviconUrl(emoji: string): string {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="50" y="50" text-anchor="middle" dominant-baseline="central" font-size="88">${escapeXml(emoji)}</text></svg>`;
	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Encode a universal `Icon` as the favicon URL the tab strip can render.
 *  Emoji → SVG data URL; Image → its `brainstorm://icon/…` URL verbatim
 *  (the strip's session serves the privileged protocol); Pack glyphs need
 *  the Phosphor dataset the strip doesn't bundle, so they degrade to
 *  {@link TAB_ICON_NONE} — the same degraded rendering `entity-icon`
 *  applies in DOM apps. */
export function tabFaviconUrl(icon: Icon | null | undefined): string {
	if (icon?.kind === IconKind.Emoji && icon.value) return emojiFaviconUrl(icon.value);
	if (icon?.kind === IconKind.Image && icon.value.startsWith("brainstorm:")) return icon.value;
	return TAB_ICON_NONE;
}
