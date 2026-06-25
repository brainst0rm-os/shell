/**
 * Minimal, namespace-tolerant WebDAV XML reading for the CalDAV client
 * (9.15.19). Servers prefix the same `DAV:` / `urn:ietf:params:xml:ns:caldav`
 * local names differently (Google `<d:…>`, Apple `<D:…>`, SabreDAV/Fastmail
 * `<d:…>` with `<cal:…>`), so everything here matches by **local name** and
 * ignores the prefix. Scope is deliberately the multistatus subset CalDAV
 * responses use — `response`/`propstat`/`prop` never self-nest, which is the
 * structural assumption the non-greedy matching relies on (pinned by the
 * Google/Apple/Fastmail fixture tests).
 */

export type DavPropstat = {
	status: string;
	/** Raw inner XML of the `<prop>` element. */
	propXml: string;
};

export type DavResponse = {
	href: string;
	/** Response-level `<status>` (sync-collection uses it for removals). */
	status: string | null;
	propstats: DavPropstat[];
};

export type DavMultistatus = {
	responses: DavResponse[];
	/** Top-level `<sync-token>` of a sync-collection REPORT. */
	syncToken: string | null;
};

const entityPattern = /&(amp|lt|gt|quot|apos|#x?[0-9a-fA-F]+);/g;

export function decodeXmlEntities(value: string): string {
	return value.replace(entityPattern, (_match, name: string) => {
		switch (name) {
			case "amp":
				return "&";
			case "lt":
				return "<";
			case "gt":
				return ">";
			case "quot":
				return '"';
			case "apos":
				return "'";
			default: {
				const code = name.startsWith("#x")
					? Number.parseInt(name.slice(2), 16)
					: Number.parseInt(name.slice(1), 10);
				return Number.isFinite(code) ? String.fromCodePoint(code) : "";
			}
		}
	});
}

export function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function elementPattern(localName: string): RegExp {
	// `<` + optional prefix + localName, then either `/>` (empty) or
	// `…>content</…localName>`. Non-greedy content — see module header.
	return new RegExp(
		`<(?:[\\w.-]+:)?${localName}(?=[\\s/>])([^>]*?)(?:/>|>([\\s\\S]*?)</(?:[\\w.-]+:)?${localName}\\s*>)`,
		"g",
	);
}

export type DavElement = {
	attrs: string;
	inner: string;
};

/** Every occurrence of `<…:localName …>…</…:localName>` (or self-closed). */
export function allElements(xml: string, localName: string): DavElement[] {
	const out: DavElement[] = [];
	const pattern = elementPattern(localName);
	let match = pattern.exec(xml);
	while (match) {
		out.push({ attrs: match[1] ?? "", inner: match[2] ?? "" });
		match = pattern.exec(xml);
	}
	return out;
}

export function firstElement(xml: string, localName: string): DavElement | null {
	const pattern = elementPattern(localName);
	const match = pattern.exec(xml);
	if (!match) return null;
	return { attrs: match[1] ?? "", inner: match[2] ?? "" };
}

/** Entity-decoded trimmed text content of the first matching element. */
export function firstElementText(xml: string, localName: string): string | null {
	const el = firstElement(xml, localName);
	if (el === null) return null;
	return decodeXmlEntities(el.inner.trim());
}

/** True when the element occurs at all — `<d:resourcetype><c:calendar/></…>`
 *  style presence checks. */
export function hasElement(xml: string, localName: string): boolean {
	return firstElement(xml, localName) !== null;
}

/** The value of an attribute on an element's raw attribute string. */
export function attrValue(attrs: string, name: string): string | null {
	const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`).exec(attrs);
	if (!match) return null;
	return decodeXmlEntities(match[1] ?? "");
}

export function parseMultistatus(xml: string): DavMultistatus {
	const responses: DavResponse[] = [];
	for (const responseEl of allElements(xml, "response")) {
		const href = firstElementText(responseEl.inner, "href");
		if (href === null || href.length === 0) continue;

		const propstats: DavPropstat[] = [];
		for (const propstatEl of allElements(responseEl.inner, "propstat")) {
			const status = firstElementText(propstatEl.inner, "status") ?? "";
			const prop = firstElement(propstatEl.inner, "prop");
			propstats.push({ status, propXml: prop?.inner ?? "" });
		}

		// A response-level <status> lives OUTSIDE any propstat — strip the
		// propstat blocks before looking so we don't pick up a prop status.
		const outsidePropstats = responseEl.inner.replace(elementPattern("propstat"), "");
		const status = firstElementText(outsidePropstats, "status");

		responses.push({ href, status, propstats });
	}

	// The top-level sync-token sits outside every <response>.
	const outsideResponses = xml.replace(elementPattern("response"), "");
	const syncToken = firstElementText(outsideResponses, "sync-token");

	return { responses, syncToken };
}

const OK_STATUS = /\b2\d\d\b/;

/** The `<prop>` inner XML of the first 2xx propstat, or null. */
export function okPropXml(response: DavResponse): string | null {
	for (const propstat of response.propstats) {
		if (OK_STATUS.test(propstat.status)) return propstat.propXml;
	}
	return null;
}

/** True when the response-level status (if any) is a 404 — how
 *  sync-collection reports a removed resource. */
export function isNotFound(response: DavResponse): boolean {
	return response.status !== null && /\b404\b/.test(response.status);
}
