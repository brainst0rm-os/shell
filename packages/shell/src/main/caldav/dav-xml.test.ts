import { describe, expect, it } from "vitest";
import {
	allElements,
	attrValue,
	decodeXmlEntities,
	escapeXml,
	firstElement,
	firstElementText,
	hasElement,
	isNotFound,
	okPropXml,
	parseMultistatus,
} from "./dav-xml";

// Google-style: lower-case `d:`/`caldav:` prefixes, server-absolute hrefs.
const GOOGLE_LISTING = `<?xml version="1.0" encoding="UTF-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:caldav="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/">
 <d:response>
  <d:href>/caldav/v2/mira%40example.com/events/</d:href>
  <d:propstat>
   <d:prop>
    <d:displayname>Mira Chen</d:displayname>
    <d:resourcetype><d:collection/><caldav:calendar/></d:resourcetype>
    <caldav:supported-calendar-component-set><caldav:comp name="VEVENT"/></caldav:supported-calendar-component-set>
    <cs:getctag>63871234567</cs:getctag>
   </d:prop>
   <d:status>HTTP/1.1 200 OK</d:status>
  </d:propstat>
 </d:response>
</d:multistatus>`;

// Apple-style: upper-case `D:` prefix, quoted etags, &amp; in displayname.
const APPLE_LISTING = `<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CS="http://calendarserver.org/ns/" xmlns:IC="http://apple.com/ns/ical/">
 <D:response>
  <D:href>/12345/calendars/home/</D:href>
  <D:propstat>
   <D:prop>
    <D:displayname>Work &amp; Life</D:displayname>
    <D:resourcetype><D:collection/><C:calendar/></D:resourcetype>
    <IC:calendar-color>#FF2968FF</IC:calendar-color>
    <CS:getctag>A1B2C3</CS:getctag>
   </D:prop>
   <D:status>HTTP/1.1 200 OK</D:status>
  </D:propstat>
 </D:response>
 <D:response>
  <D:href>/12345/calendars/inbox/</D:href>
  <D:propstat>
   <D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop>
   <D:status>HTTP/1.1 200 OK</D:status>
  </D:propstat>
 </D:response>
</D:multistatus>`;

// Fastmail/SabreDAV-style sync-collection delta with a removal + token.
const FASTMAIL_SYNC = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns">
 <d:response>
  <d:href>/dav/calendars/user/mira@fastmail.com/default/abc.ics</d:href>
  <d:propstat>
   <d:prop><d:getetag>&quot;e1&quot;</d:getetag></d:prop>
   <d:status>HTTP/1.1 200 OK</d:status>
  </d:propstat>
 </d:response>
 <d:response>
  <d:href>/dav/calendars/user/mira@fastmail.com/default/gone.ics</d:href>
  <d:status>HTTP/1.1 404 Not Found</d:status>
 </d:response>
 <d:sync-token>https://fastmail.com/sync/00000123</d:sync-token>
</d:multistatus>`;

describe("decodeXmlEntities / escapeXml", () => {
	it("decodes the five named entities and numeric refs", () => {
		expect(decodeXmlEntities("a&amp;b &lt;c&gt; &quot;d&quot; &apos;e&apos; &#65; &#x42;")).toBe(
			"a&b <c> \"d\" 'e' A B",
		);
	});

	it("escape → decode round-trips", () => {
		const raw = 'Meeting <Q3 & "planning">';
		expect(decodeXmlEntities(escapeXml(raw))).toBe(raw);
	});
});

describe("parseMultistatus", () => {
	it("reads a Google-shaped PROPFIND listing", () => {
		const ms = parseMultistatus(GOOGLE_LISTING);
		expect(ms.responses).toHaveLength(1);
		const response = ms.responses[0];
		expect(response?.href).toBe("/caldav/v2/mira%40example.com/events/");
		const propXml = response ? okPropXml(response) : null;
		expect(propXml).not.toBeNull();
		expect(firstElementText(propXml ?? "", "displayname")).toBe("Mira Chen");
		expect(firstElementText(propXml ?? "", "getctag")).toBe("63871234567");
		const rt = firstElement(propXml ?? "", "resourcetype");
		expect(rt && hasElement(rt.inner, "calendar")).toBe(true);
	});

	it("reads an Apple-shaped (upper-case prefix) listing with entities", () => {
		const ms = parseMultistatus(APPLE_LISTING);
		expect(ms.responses).toHaveLength(2);
		const home = ms.responses[0];
		const propXml = home ? okPropXml(home) : null;
		expect(firstElementText(propXml ?? "", "displayname")).toBe("Work & Life");
		expect(firstElementText(propXml ?? "", "calendar-color")).toBe("#FF2968FF");
		// The inbox is a plain collection — no calendar resourcetype.
		const inboxProps = ms.responses[1] ? okPropXml(ms.responses[1]) : null;
		const inboxRt = firstElement(inboxProps ?? "", "resourcetype");
		expect(inboxRt && hasElement(inboxRt.inner, "calendar")).toBe(false);
	});

	it("reads a Fastmail-shaped sync-collection delta (changed + 404 removal + token)", () => {
		const ms = parseMultistatus(FASTMAIL_SYNC);
		expect(ms.syncToken).toBe("https://fastmail.com/sync/00000123");
		expect(ms.responses).toHaveLength(2);
		const changed = ms.responses[0];
		const removed = ms.responses[1];
		expect(changed && isNotFound(changed)).toBe(false);
		expect(firstElementText(changed ? (okPropXml(changed) ?? "") : "", "getetag")).toBe('"e1"');
		expect(removed && isNotFound(removed)).toBe(true);
		expect(removed?.propstats).toHaveLength(0);
	});

	it("a response-level status is not confused with a propstat status", () => {
		const ms = parseMultistatus(FASTMAIL_SYNC);
		expect(ms.responses[0]?.status).toBeNull();
	});
});

describe("allElements / attrValue", () => {
	it("collects repeated elements and reads attributes", () => {
		const xml = '<c:comp name="VEVENT"/><c:comp name="VTODO"/>';
		const comps = allElements(xml, "comp");
		expect(comps).toHaveLength(2);
		expect(attrValue(comps[0]?.attrs ?? "", "name")).toBe("VEVENT");
		expect(attrValue(comps[1]?.attrs ?? "", "name")).toBe("VTODO");
	});

	it("handles self-closing and prefixed forms alike", () => {
		expect(hasElement("<D:calendar/>", "calendar")).toBe(true);
		expect(hasElement("<calendar></calendar>", "calendar")).toBe(true);
		expect(hasElement("<calendars/>", "calendar")).toBe(false);
	});
});
