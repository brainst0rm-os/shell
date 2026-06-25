/**
 * CalDAV protocol client (9.15.19) — discovery, collection listing,
 * incremental pull, and etag-guarded write-back, over one injected
 * `DavRequestFn`. Production binds that seam to the connector framework's
 * audited egress with the Tier-2 Basic credential injected main-side
 * (`caldav-service.ts`); tests inject recorded Google / Apple / Fastmail
 * payloads — the client itself never sees a credential and never fetches
 * raw.
 *
 * Incremental model: RFC 6578 `sync-collection` REPORT with the server's
 * `sync-token`; a server that rejects the token (expired / unsupported)
 * degrades to a full `calendar-query` etag listing the engine diffs
 * against its `knownHrefs` ledger.
 */

import {
	type DavResponse,
	escapeXml,
	firstElement,
	firstElementText,
	hasElement,
	isNotFound,
	okPropXml,
	parseMultistatus,
} from "./dav-xml";

export type DavResult = {
	status: number;
	headers: Readonly<Record<string, string>>;
	body: string;
	finalUrl: string;
};

/** The one IO seam. Production injects auth + egress scoping around it. */
export type DavRequestFn = (input: {
	method: string;
	url: string;
	headers?: Record<string, string>;
	body?: string;
}) => Promise<DavResult>;

export enum DavMethod {
	Propfind = "PROPFIND",
	Report = "REPORT",
	Put = "PUT",
	Delete = "DELETE",
}

export enum PutOutcome {
	Created = "created",
	Updated = "updated",
	Conflict = "conflict",
}

export enum DeleteOutcome {
	Deleted = "deleted",
	Missing = "missing",
	Conflict = "conflict",
}

export type CalendarCollection = {
	url: string;
	displayName: string;
	color: string | null;
	supportsEvents: boolean;
	ctag: string | null;
};

export type SyncCollectionResult = {
	changed: { href: string; etag: string | null }[];
	removed: string[];
	syncToken: string | null;
	/** True when the server rejected the sync-token (or doesn't support
	 *  sync-collection) — the caller must fall back to a full listing. */
	fullResyncRequired: boolean;
};

export type CalendarObject = {
	href: string;
	etag: string | null;
	ics: string;
};

export class CalDavRequestError extends Error {
	constructor(
		readonly status: number,
		context: string,
	) {
		super(`${context}: server returned ${status}`);
		this.name = "CalDavRequestError";
	}
}

const XML_HEADER = '<?xml version="1.0" encoding="utf-8"?>';
const NS_DAV = 'xmlns:d="DAV:"';
const NS_CALDAV = 'xmlns:c="urn:ietf:params:xml:ns:caldav"';
const NS_CALSERVER = 'xmlns:cs="http://calendarserver.org/ns/"';
const NS_APPLE_ICAL = 'xmlns:ic="http://apple.com/ns/ical/"';
const WELL_KNOWN_PATH = "/.well-known/caldav";
const MULTIGET_PAGE = 50;
/** RFC 6578: an expired/unknown sync-token answers 403/409 (precondition
 *  `valid-sync-token`); some servers use 507 for a truncated journal. */
const TOKEN_REJECTED_STATUSES = new Set([400, 403, 409, 507]);

function ok(status: number): boolean {
	return status >= 200 && status < 300;
}

function requireOk(result: DavResult, context: string): void {
	if (!ok(result.status)) throw new CalDavRequestError(result.status, context);
}

/** Resolve a multistatus `href` (usually a server-absolute path) against
 *  the URL the request actually landed on. */
function resolveHref(href: string, baseUrl: string): string {
	return new URL(href, baseUrl).toString();
}

function etagFromProps(propXml: string): string | null {
	return firstElementText(propXml, "getetag");
}

function headerValue(headers: Readonly<Record<string, string>>, name: string): string | null {
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === name) return value;
	}
	return null;
}

export class CalDavClient {
	constructor(private readonly request: DavRequestFn) {}

	/** RFC 6764 discovery: `/.well-known/caldav` → `current-user-principal`
	 *  → `calendar-home-set`. Servers that 404 the well-known path are
	 *  retried at the entered URL itself. */
	async discover(serverUrl: string): Promise<{ principalUrl: string; homeUrl: string }> {
		const wellKnown = new URL(WELL_KNOWN_PATH, serverUrl).toString();
		let principal = await this.findPrincipal(wellKnown);
		if (principal === null) principal = await this.findPrincipal(serverUrl);
		if (principal === null) {
			throw new Error("caldav discovery: server did not report a current-user-principal");
		}

		const body = `${XML_HEADER}<d:propfind ${NS_DAV} ${NS_CALDAV}><d:prop><c:calendar-home-set/></d:prop></d:propfind>`;
		const result = await this.propfind(principal, "0", body);
		requireOk(result, "caldav discovery (calendar-home-set)");
		const home = this.singlePropHref(result, "calendar-home-set");
		if (home === null) {
			throw new Error("caldav discovery: principal did not report a calendar-home-set");
		}
		return { principalUrl: principal, homeUrl: home };
	}

	private async findPrincipal(url: string): Promise<string | null> {
		const body = `${XML_HEADER}<d:propfind ${NS_DAV}><d:prop><d:current-user-principal/></d:prop></d:propfind>`;
		let result: DavResult;
		try {
			result = await this.propfind(url, "0", body);
		} catch {
			return null;
		}
		if (!ok(result.status)) return null;
		return this.singlePropHref(result, "current-user-principal");
	}

	private singlePropHref(result: DavResult, propLocalName: string): string | null {
		const multistatus = parseMultistatus(result.body);
		for (const response of multistatus.responses) {
			const propXml = okPropXml(response);
			if (propXml === null) continue;
			const el = firstElement(propXml, propLocalName);
			if (el === null) continue;
			const href = firstElementText(el.inner, "href");
			if (href !== null && href.length > 0) return resolveHref(href, result.finalUrl);
		}
		return null;
	}

	/** Depth-1 PROPFIND of the calendar home — every child collection whose
	 *  `resourcetype` carries `calendar`. */
	async listCalendars(homeUrl: string): Promise<CalendarCollection[]> {
		const body = `${XML_HEADER}<d:propfind ${NS_DAV} ${NS_CALDAV} ${NS_CALSERVER} ${NS_APPLE_ICAL}><d:prop><d:displayname/><d:resourcetype/><c:supported-calendar-component-set/><cs:getctag/><ic:calendar-color/></d:prop></d:propfind>`;
		const result = await this.propfind(homeUrl, "1", body);
		requireOk(result, "caldav list calendars");

		const collections: CalendarCollection[] = [];
		const multistatus = parseMultistatus(result.body);
		for (const response of multistatus.responses) {
			const propXml = okPropXml(response);
			if (propXml === null) continue;
			const resourceType = firstElement(propXml, "resourcetype");
			if (resourceType === null || !hasElement(resourceType.inner, "calendar")) continue;

			const url = resolveHref(response.href, result.finalUrl);
			const displayName = firstElementText(propXml, "displayname") ?? url;
			const color = firstElementText(propXml, "calendar-color");
			const componentSet = firstElement(propXml, "supported-calendar-component-set");
			const supportsEvents = componentSet === null || /name\s*=\s*"VEVENT"/.test(componentSet.inner);
			collections.push({
				url,
				displayName,
				color,
				supportsEvents,
				ctag: firstElementText(propXml, "getctag"),
			});
		}
		return collections;
	}

	/** RFC 6578 incremental delta. An empty `syncToken` asks for the full
	 *  initial state + a first token. */
	async syncCollection(
		calendarUrl: string,
		syncToken: string | null,
	): Promise<SyncCollectionResult> {
		const tokenXml =
			syncToken === null ? "<d:sync-token/>" : `<d:sync-token>${escapeXml(syncToken)}</d:sync-token>`;
		const body = `${XML_HEADER}<d:sync-collection ${NS_DAV}>${tokenXml}<d:sync-level>1</d:sync-level><d:prop><d:getetag/></d:prop></d:sync-collection>`;
		const result = await this.report(calendarUrl, body);
		if (
			TOKEN_REJECTED_STATUSES.has(result.status) ||
			result.status === 405 ||
			result.status === 501
		) {
			return { changed: [], removed: [], syncToken: null, fullResyncRequired: true };
		}
		requireOk(result, "caldav sync-collection");

		const multistatus = parseMultistatus(result.body);
		const changed: { href: string; etag: string | null }[] = [];
		const removed: string[] = [];
		const collectionPath = new URL(calendarUrl, result.finalUrl).pathname;
		for (const response of multistatus.responses) {
			const href = resolveHref(response.href, result.finalUrl);
			// The collection itself can appear as a member — never an event.
			if (new URL(href).pathname === collectionPath) continue;
			if (isNotFound(response)) {
				removed.push(href);
				continue;
			}
			const propXml = okPropXml(response);
			changed.push({ href, etag: propXml === null ? null : etagFromProps(propXml) });
		}
		return { changed, removed, syncToken: multistatus.syncToken, fullResyncRequired: false };
	}

	/** Full etag listing via `calendar-query` — the initial pull and the
	 *  expired-token fallback. */
	async listEventHrefs(calendarUrl: string): Promise<{ href: string; etag: string | null }[]> {
		const body = `${XML_HEADER}<c:calendar-query ${NS_DAV} ${NS_CALDAV}><d:prop><d:getetag/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"/></c:comp-filter></c:filter></c:calendar-query>`;
		const result = await this.report(calendarUrl, body);
		requireOk(result, "caldav calendar-query");

		const out: { href: string; etag: string | null }[] = [];
		for (const response of parseMultistatus(result.body).responses) {
			const propXml = okPropXml(response);
			if (propXml === null) continue;
			out.push({ href: resolveHref(response.href, result.finalUrl), etag: etagFromProps(propXml) });
		}
		return out;
	}

	/** `calendar-multiget` the iCalendar payloads for a set of hrefs, paged. */
	async multiGet(calendarUrl: string, hrefs: readonly string[]): Promise<CalendarObject[]> {
		const out: CalendarObject[] = [];
		for (let i = 0; i < hrefs.length; i += MULTIGET_PAGE) {
			const page = hrefs.slice(i, i + MULTIGET_PAGE);
			const hrefXml = page
				.map((href) => `<d:href>${escapeXml(new URL(href, calendarUrl).pathname)}</d:href>`)
				.join("");
			const body = `${XML_HEADER}<c:calendar-multiget ${NS_DAV} ${NS_CALDAV}><d:prop><d:getetag/><c:calendar-data/></d:prop>${hrefXml}</c:calendar-multiget>`;
			const result = await this.report(calendarUrl, body);
			requireOk(result, "caldav multiget");

			for (const response of parseMultistatus(result.body).responses) {
				const propXml = okPropXml(response);
				if (propXml === null) continue;
				const ics = firstElementText(propXml, "calendar-data");
				if (ics === null || ics.length === 0) continue;
				out.push({
					href: resolveHref(response.href, result.finalUrl),
					etag: etagFromProps(propXml),
					ics,
				});
			}
		}
		return out;
	}

	/** Etag-guarded write: `If-Match` on update, `If-None-Match: *` on
	 *  create. A 412 is the conflict signal the engine's server-wins
	 *  policy keys off — never thrown. */
	async putEvent(input: { url: string; ics: string; etag?: string }): Promise<{
		outcome: PutOutcome;
		etag: string | null;
	}> {
		const headers: Record<string, string> = {
			"content-type": "text/calendar; charset=utf-8",
			...(input.etag === undefined ? { "if-none-match": "*" } : { "if-match": input.etag }),
		};
		const result = await this.request({
			method: DavMethod.Put,
			url: input.url,
			headers,
			body: input.ics,
		});
		if (result.status === 412) return { outcome: PutOutcome.Conflict, etag: null };
		requireOk(result, "caldav put");
		return {
			outcome: input.etag === undefined ? PutOutcome.Created : PutOutcome.Updated,
			etag: headerValue(result.headers, "etag"),
		};
	}

	async deleteEvent(url: string, etag?: string): Promise<DeleteOutcome> {
		const result = await this.request({
			method: DavMethod.Delete,
			url,
			...(etag !== undefined ? { headers: { "if-match": etag } } : {}),
		});
		if (result.status === 412) return DeleteOutcome.Conflict;
		if (result.status === 404) return DeleteOutcome.Missing;
		requireOk(result, "caldav delete");
		return DeleteOutcome.Deleted;
	}

	private propfind(url: string, depth: string, body: string): Promise<DavResult> {
		return this.request({
			method: DavMethod.Propfind,
			url,
			headers: { depth, "content-type": "application/xml; charset=utf-8" },
			body,
		});
	}

	private report(url: string, body: string): Promise<DavResult> {
		return this.request({
			method: DavMethod.Report,
			url,
			headers: { depth: "1", "content-type": "application/xml; charset=utf-8" },
			body,
		});
	}
}
