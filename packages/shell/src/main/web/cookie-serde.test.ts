import { describe, expect, it } from "vitest";
import { type CookieRecord, SameSitePolicy } from "../storage/cookie-jar-repo";
import { type ReadCookie, cookieKey, cookieToRecord, recordToSetSpec } from "./cookie-serde";

const liveCookie: ReadCookie = {
	name: "session",
	value: "abc123",
	domain: ".example.com",
	hostOnly: false,
	path: "/",
	secure: true,
	httpOnly: true,
	session: false,
	expirationDate: 4_000_000_000,
	sameSite: "lax",
};

describe("cookieToRecord", () => {
	it("maps a persistable cookie to a record", () => {
		expect(cookieToRecord(liveCookie)).toEqual<CookieRecord>({
			name: "session",
			domain: ".example.com",
			path: "/",
			value: "abc123",
			hostOnly: false,
			secure: true,
			httpOnly: true,
			sameSite: SameSitePolicy.Lax,
			expiration: 4_000_000_000,
		});
	});

	it("refuses session cookies (session flag)", () => {
		expect(cookieToRecord({ ...liveCookie, session: true })).toBeNull();
	});

	it("refuses cookies with no expiration (also session)", () => {
		const { expirationDate: _drop, ...noExpiry } = liveCookie;
		expect(cookieToRecord(noExpiry)).toBeNull();
	});

	it("refuses cookies with no domain (nothing to key on)", () => {
		const { domain: _drop, ...noDomain } = liveCookie;
		expect(cookieToRecord(noDomain)).toBeNull();
	});

	it("defaults an empty path to / and unknown sameSite to unspecified", () => {
		const record = cookieToRecord({ ...liveCookie, path: "", sameSite: "bogus" });
		expect(record?.path).toBe("/");
		expect(record?.sameSite).toBe(SameSitePolicy.Unspecified);
	});
});

describe("recordToSetSpec", () => {
	it("reconstructs an https url + domain for a secure domain cookie", () => {
		const spec = recordToSetSpec(cookieToRecord(liveCookie) as CookieRecord);
		expect(spec).toMatchObject({
			url: "https://example.com/",
			domain: ".example.com",
			secure: true,
			sameSite: SameSitePolicy.Lax,
			expirationDate: 4_000_000_000,
		});
	});

	it("omits domain for a host-only cookie and uses http when insecure", () => {
		const record: CookieRecord = {
			name: "ho",
			domain: "host.example.com",
			path: "/a",
			value: "v",
			hostOnly: true,
			secure: false,
			httpOnly: false,
			sameSite: SameSitePolicy.Strict,
			expiration: 4_000_000_000,
		};
		const spec = recordToSetSpec(record);
		expect(spec.url).toBe("http://host.example.com/a");
		expect(spec.domain).toBeUndefined();
	});

	it("round-trips live cookie -> record -> set-spec consistently", () => {
		const record = cookieToRecord(liveCookie) as CookieRecord;
		const spec = recordToSetSpec(record);
		expect(spec.name).toBe(record.name);
		expect(spec.value).toBe(record.value);
		expect(spec.path).toBe(record.path);
		expect(spec.httpOnly).toBe(record.httpOnly);
	});
});

describe("cookieKey", () => {
	it("extracts the identity tuple with path defaulting", () => {
		expect(cookieKey({ ...liveCookie, path: "" })).toEqual({
			name: "session",
			domain: ".example.com",
			path: "/",
		});
	});

	it("returns null without a domain", () => {
		const { domain: _drop, ...noDomain } = liveCookie;
		expect(cookieKey(noDomain)).toBeNull();
	});
});
