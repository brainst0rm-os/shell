/**
 * URL → embed classification. Pure + dependency-free so it unit-tests
 * exhaustively and runs the same in the paste path and the slash path.
 *
 * Only an allowlist of providers becomes an `<iframe>` embed; anything
 * else is a bookmark card. The allowlist maps a watch/share URL to the
 * provider's official embeddable URL so we never iframe an arbitrary
 * origin.
 */

export enum EmbedKind {
	YouTube = "youtube",
	Vimeo = "vimeo",
	Loom = "loom",
	Figma = "figma",
	CodeSandbox = "codesandbox",
	/** Not embeddable — render a link/bookmark card instead. */
	Bookmark = "bookmark",
}

export type UrlClassification = {
	kind: EmbedKind;
	/** The src for the `<iframe>` when `kind !== Bookmark`. */
	embedUrl: string | null;
	host: string;
};

/** Parse a string into a URL, tolerating a missing scheme (`foo.com` →
 *  `https://foo.com`). Returns null when it still isn't a valid http(s)
 *  URL. */
export function parseHttpUrl(raw: string): URL | null {
	const trimmed = raw.trim();
	if (trimmed.length === 0) return null;
	const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
	let url: URL;
	try {
		url = new URL(candidate);
	} catch {
		return null;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return null;
	if (!url.hostname.includes(".")) return null;
	return url;
}

/** True for a string that is *only* a single URL (the paste-to-bookmark
 *  trigger — pasting a sentence that contains a link must not convert). */
export function isLoneUrl(raw: string): boolean {
	const trimmed = raw.trim();
	if (/\s/.test(trimmed)) return false;
	return parseHttpUrl(trimmed) !== null;
}

function youTubeId(url: URL): string | null {
	if (url.hostname === "youtu.be") return url.pathname.slice(1) || null;
	if (url.hostname.endsWith("youtube.com")) {
		if (url.pathname === "/watch") return url.searchParams.get("v");
		const m = url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/);
		if (m) return m[1] ?? null;
	}
	return null;
}

export function classifyUrl(raw: string): UrlClassification | null {
	const url = parseHttpUrl(raw);
	if (!url) return null;
	const host = url.hostname.replace(/^www\./, "");

	const yt = youTubeId(url);
	if (yt) {
		return {
			kind: EmbedKind.YouTube,
			embedUrl: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(yt)}`,
			host,
		};
	}

	if (host === "vimeo.com") {
		const id = url.pathname.split("/").filter(Boolean)[0];
		if (id && /^\d+$/.test(id)) {
			return { kind: EmbedKind.Vimeo, embedUrl: `https://player.vimeo.com/video/${id}`, host };
		}
	}

	if (host === "loom.com" && url.pathname.startsWith("/share/")) {
		const id = url.pathname.replace("/share/", "").split("/")[0];
		if (id) {
			return { kind: EmbedKind.Loom, embedUrl: `https://www.loom.com/embed/${id}`, host };
		}
	}

	if (host === "figma.com" || host.endsWith(".figma.com")) {
		return {
			kind: EmbedKind.Figma,
			embedUrl: `https://www.figma.com/embed?embed_host=brainstorm&url=${encodeURIComponent(url.href)}`,
			host,
		};
	}

	if (host === "codesandbox.io" && url.pathname.startsWith("/s/")) {
		return {
			kind: EmbedKind.CodeSandbox,
			embedUrl: `https://codesandbox.io/embed/${url.pathname.replace("/s/", "")}`,
			host,
		};
	}

	return { kind: EmbedKind.Bookmark, embedUrl: null, host };
}

/** Best-effort favicon for a bookmark card. Uses the origin's
 *  conventional path; the renderer falls back to a generic glyph
 *  `onerror`, so a 404 is harmless and no metadata service is needed. */
export function faviconUrl(raw: string): string | null {
	const url = parseHttpUrl(raw);
	return url ? `${url.origin}/favicon.ico` : null;
}
