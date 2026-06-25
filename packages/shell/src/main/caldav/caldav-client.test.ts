import { describe, expect, it } from "vitest";
import {
	CalDavClient,
	CalDavRequestError,
	type DavRequestFn,
	type DavResult,
	DeleteOutcome,
	PutOutcome,
} from "./caldav-client";

type CannedRoute = {
	match: (req: { method: string; url: string; body?: string }) => boolean;
	respond: (req: { method: string; url: string; body?: string }) => Partial<DavResult>;
};

function fakeRequest(routes: CannedRoute[]): {
	request: DavRequestFn;
	calls: { method: string; url: string; headers?: Record<string, string>; body?: string }[];
} {
	const calls: { method: string; url: string; headers?: Record<string, string>; body?: string }[] =
		[];
	const request: DavRequestFn = (req) => {
		calls.push(req);
		for (const route of routes) {
			if (route.match(req)) {
				const partial = route.respond(req);
				return Promise.resolve({
					status: partial.status ?? 207,
					headers: partial.headers ?? {},
					body: partial.body ?? "",
					finalUrl: partial.finalUrl ?? req.url,
				});
			}
		}
		return Promise.resolve({ status: 404, headers: {}, body: "", finalUrl: req.url });
	};
	return { request, calls };
}

// ── Discovery fixtures (Apple-shaped, with a cross-host home) ──────────

const APPLE_PRINCIPAL = `<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:">
 <D:response>
  <D:href>/.well-known/caldav</D:href>
  <D:propstat>
   <D:prop><D:current-user-principal><D:href>/123456/principal/</D:href></D:current-user-principal></D:prop>
   <D:status>HTTP/1.1 200 OK</D:status>
  </D:propstat>
 </D:response>
</D:multistatus>`;

const APPLE_HOME = `<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
 <D:response>
  <D:href>/123456/principal/</D:href>
  <D:propstat>
   <D:prop><C:calendar-home-set><D:href>https://p42-caldav.icloud.com/123456/calendars/</D:href></C:calendar-home-set></D:prop>
   <D:status>HTTP/1.1 200 OK</D:status>
  </D:propstat>
 </D:response>
</D:multistatus>`;

// Google-shaped listing under the home.
const GOOGLE_CALENDARS = `<?xml version="1.0" encoding="UTF-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:caldav="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/">
 <d:response>
  <d:href>/caldav/v2/mira%40example.com/events/</d:href>
  <d:propstat>
   <d:prop>
    <d:displayname>Mira Chen</d:displayname>
    <d:resourcetype><d:collection/><caldav:calendar/></d:resourcetype>
    <caldav:supported-calendar-component-set><caldav:comp name="VEVENT"/></caldav:supported-calendar-component-set>
    <cs:getctag>1001</cs:getctag>
   </d:prop>
   <d:status>HTTP/1.1 200 OK</d:status>
  </d:propstat>
 </d:response>
 <d:response>
  <d:href>/caldav/v2/mira%40example.com/tasks/</d:href>
  <d:propstat>
   <d:prop>
    <d:displayname>Tasks only</d:displayname>
    <d:resourcetype><d:collection/><caldav:calendar/></d:resourcetype>
    <caldav:supported-calendar-component-set><caldav:comp name="VTODO"/></caldav:supported-calendar-component-set>
   </d:prop>
   <d:status>HTTP/1.1 200 OK</d:status>
  </d:propstat>
 </d:response>
 <d:response>
  <d:href>/caldav/v2/mira%40example.com/</d:href>
  <d:propstat>
   <d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop>
   <d:status>HTTP/1.1 200 OK</d:status>
  </d:propstat>
 </d:response>
</d:multistatus>`;

const FASTMAIL_SYNC_DELTA = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
 <d:response>
  <d:href>/dav/calendars/user/mira/default/</d:href>
  <d:propstat>
   <d:prop/>
   <d:status>HTTP/1.1 200 OK</d:status>
  </d:propstat>
 </d:response>
 <d:response>
  <d:href>/dav/calendars/user/mira/default/ev1.ics</d:href>
  <d:propstat>
   <d:prop><d:getetag>"e1"</d:getetag></d:prop>
   <d:status>HTTP/1.1 200 OK</d:status>
  </d:propstat>
 </d:response>
 <d:response>
  <d:href>/dav/calendars/user/mira/default/gone.ics</d:href>
  <d:status>HTTP/1.1 404 Not Found</d:status>
 </d:response>
 <d:sync-token>tok-2</d:sync-token>
</d:multistatus>`;

const MULTIGET_RESPONSE = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
 <d:response>
  <d:href>/dav/calendars/user/mira/default/ev1.ics</d:href>
  <d:propstat>
   <d:prop>
    <d:getetag>"e1"</d:getetag>
    <c:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:ev1
DTSTAMP:20260610T000000Z
DTSTART:20260620T100000Z
SUMMARY:Synced &amp; sound
END:VEVENT
END:VCALENDAR
</c:calendar-data>
   </d:prop>
   <d:status>HTTP/1.1 200 OK</d:status>
  </d:propstat>
 </d:response>
</d:multistatus>`;

const FASTMAIL_BASE = "https://caldav.fastmail.com";
const CAL_URL = `${FASTMAIL_BASE}/dav/calendars/user/mira/default/`;

describe("CalDavClient.discover", () => {
	it("walks well-known → principal → home, resolving cross-host hrefs", async () => {
		const { request, calls } = fakeRequest([
			{
				match: (r) => r.url.endsWith("/.well-known/caldav"),
				respond: () => ({
					body: APPLE_PRINCIPAL,
					finalUrl: "https://caldav.icloud.com/.well-known/caldav",
				}),
			},
			{
				match: (r) => r.url === "https://caldav.icloud.com/123456/principal/",
				respond: () => ({ body: APPLE_HOME }),
			},
		]);
		const client = new CalDavClient(request);
		const found = await client.discover("https://caldav.icloud.com/");
		expect(found.principalUrl).toBe("https://caldav.icloud.com/123456/principal/");
		expect(found.homeUrl).toBe("https://p42-caldav.icloud.com/123456/calendars/");
		expect(calls.every((c) => c.method === "PROPFIND")).toBe(true);
		expect(calls[0]?.headers?.depth).toBe("0");
	});

	it("falls back to the entered URL when the well-known path 404s", async () => {
		const { request } = fakeRequest([
			{
				match: (r) => r.url === "https://dav.example.com/users/mira",
				respond: () => ({ body: APPLE_PRINCIPAL }),
			},
			{
				match: (r) => r.url === "https://dav.example.com/123456/principal/",
				respond: () => ({ body: APPLE_HOME }),
			},
		]);
		const client = new CalDavClient(request);
		const found = await client.discover("https://dav.example.com/users/mira");
		expect(found.homeUrl).toBe("https://p42-caldav.icloud.com/123456/calendars/");
	});

	it("throws a typed discovery error when no principal is reported", async () => {
		const { request } = fakeRequest([]);
		const client = new CalDavClient(request);
		await expect(client.discover("https://nowhere.example.com/")).rejects.toThrow(
			/current-user-principal/,
		);
	});
});

describe("CalDavClient.listCalendars", () => {
	it("keeps only calendar collections and reads VEVENT support", async () => {
		const { request } = fakeRequest([
			{
				match: (r) => r.method === "PROPFIND",
				respond: () => ({ body: GOOGLE_CALENDARS }),
			},
		]);
		const client = new CalDavClient(request);
		const calendars = await client.listCalendars(
			"https://apidata.googleusercontent.com/caldav/v2/mira%40example.com/",
		);
		expect(calendars).toHaveLength(2);
		expect(calendars[0]).toMatchObject({
			displayName: "Mira Chen",
			supportsEvents: true,
			ctag: "1001",
		});
		expect(calendars[1]).toMatchObject({ displayName: "Tasks only", supportsEvents: false });
	});
});

describe("CalDavClient.syncCollection", () => {
	it("returns changed + removed + the advanced token, skipping the collection itself", async () => {
		const { request, calls } = fakeRequest([
			{
				match: (r) => r.method === "REPORT" && (r.body ?? "").includes("sync-collection"),
				respond: () => ({ body: FASTMAIL_SYNC_DELTA }),
			},
		]);
		const client = new CalDavClient(request);
		const delta = await client.syncCollection(CAL_URL, "tok-1");
		expect(calls[0]?.body).toContain("<d:sync-token>tok-1</d:sync-token>");
		expect(delta.fullResyncRequired).toBe(false);
		expect(delta.syncToken).toBe("tok-2");
		expect(delta.changed).toEqual([{ href: `${CAL_URL}ev1.ics`, etag: '"e1"' }]);
		expect(delta.removed).toEqual([`${CAL_URL}gone.ics`]);
	});

	it("flags a rejected sync-token for full resync instead of throwing", async () => {
		const { request } = fakeRequest([
			{
				match: (r) => r.method === "REPORT",
				respond: () => ({ status: 409, body: "<error/>" }),
			},
		]);
		const client = new CalDavClient(request);
		const delta = await client.syncCollection(CAL_URL, "expired");
		expect(delta.fullResyncRequired).toBe(true);
	});

	it("throws a typed error on a 5xx", async () => {
		const { request } = fakeRequest([{ match: () => true, respond: () => ({ status: 503 }) }]);
		const client = new CalDavClient(request);
		await expect(client.syncCollection(CAL_URL, null)).rejects.toBeInstanceOf(CalDavRequestError);
	});
});

describe("CalDavClient.multiGet", () => {
	it("returns href + etag + decoded calendar-data", async () => {
		const { request, calls } = fakeRequest([
			{
				match: (r) => r.method === "REPORT" && (r.body ?? "").includes("calendar-multiget"),
				respond: () => ({ body: MULTIGET_RESPONSE }),
			},
		]);
		const client = new CalDavClient(request);
		const objects = await client.multiGet(CAL_URL, [`${CAL_URL}ev1.ics`]);
		expect(calls[0]?.body).toContain("<d:href>/dav/calendars/user/mira/default/ev1.ics</d:href>");
		expect(objects).toHaveLength(1);
		expect(objects[0]?.etag).toBe('"e1"');
		// XML entities inside calendar-data decode (&amp; → &).
		expect(objects[0]?.ics).toContain("SUMMARY:Synced & sound");
	});

	it("pages large href sets", async () => {
		const { request, calls } = fakeRequest([
			{ match: () => true, respond: () => ({ body: MULTIGET_RESPONSE }) },
		]);
		const client = new CalDavClient(request);
		const hrefs = Array.from({ length: 120 }, (_v, i) => `${CAL_URL}e${i}.ics`);
		await client.multiGet(CAL_URL, hrefs);
		expect(calls).toHaveLength(3);
	});
});

describe("CalDavClient.putEvent / deleteEvent", () => {
	it("creates with If-None-Match: * and surfaces the new etag", async () => {
		const { request, calls } = fakeRequest([
			{
				match: (r) => r.method === "PUT",
				respond: () => ({ status: 201, headers: { ETag: '"new-1"' } }),
			},
		]);
		const client = new CalDavClient(request);
		const result = await client.putEvent({ url: `${CAL_URL}new.ics`, ics: "BEGIN:VCALENDAR" });
		expect(result.outcome).toBe(PutOutcome.Created);
		expect(result.etag).toBe('"new-1"');
		expect(calls[0]?.headers?.["if-none-match"]).toBe("*");
		expect(calls[0]?.headers?.["content-type"]).toContain("text/calendar");
	});

	it("updates with If-Match and maps a 412 to Conflict", async () => {
		const { request, calls } = fakeRequest([
			{ match: (r) => r.method === "PUT", respond: () => ({ status: 412 }) },
		]);
		const client = new CalDavClient(request);
		const result = await client.putEvent({
			url: `${CAL_URL}ev1.ics`,
			ics: "BEGIN:VCALENDAR",
			etag: '"e1"',
		});
		expect(result.outcome).toBe(PutOutcome.Conflict);
		expect(calls[0]?.headers?.["if-match"]).toBe('"e1"');
	});

	it("delete maps 412 → Conflict and 404 → Missing", async () => {
		const responses = [412, 404, 204];
		const { request } = fakeRequest([
			{
				match: (r) => r.method === "DELETE",
				respond: () => ({ status: responses.shift() ?? 500 }),
			},
		]);
		const client = new CalDavClient(request);
		expect(await client.deleteEvent(`${CAL_URL}a.ics`, '"e"')).toBe(DeleteOutcome.Conflict);
		expect(await client.deleteEvent(`${CAL_URL}b.ics`)).toBe(DeleteOutcome.Missing);
		expect(await client.deleteEvent(`${CAL_URL}c.ics`, '"e"')).toBe(DeleteOutcome.Deleted);
	});
});
