import { describe, expect, it } from "vitest";
import { isValidHostPattern, matchesHostPattern } from "./host-patterns";

describe("matchesHostPattern — grammar table", () => {
	it("empty patterns → no match", () => {
		expect(matchesHostPattern("api.example.com", [])).toBe(false);
	});

	it("`*` matches everything", () => {
		expect(matchesHostPattern("api.example.com", ["*"])).toBe(true);
		expect(matchesHostPattern("8.8.8.8", ["*"])).toBe(true);
	});

	it("exact hostname match is case-insensitive", () => {
		expect(matchesHostPattern("api.example.com", ["api.example.com"])).toBe(true);
		expect(matchesHostPattern("OTHER.example.com", ["other.example.com"])).toBe(true);
		expect(matchesHostPattern("api.example.com", ["api.example.net"])).toBe(false);
	});

	it("leading-dot suffix matches subdomain AND base", () => {
		expect(matchesHostPattern("api.example.com", [".example.com"])).toBe(true);
		expect(matchesHostPattern("example.com", [".example.com"])).toBe(true);
		expect(matchesHostPattern("deep.api.example.com", [".example.com"])).toBe(true);
		expect(matchesHostPattern("example.net", [".example.com"])).toBe(false);
	});

	it("leading-star matches subdomains only, not the base", () => {
		expect(matchesHostPattern("api.example.com", ["*.example.com"])).toBe(true);
		expect(matchesHostPattern("deep.api.example.com", ["*.example.com"])).toBe(true);
		expect(matchesHostPattern("example.com", ["*.example.com"])).toBe(false);
	});

	it("CIDR matches IPv4 in range", () => {
		expect(matchesHostPattern("10.0.0.1", ["10.0.0.0/8"])).toBe(true);
		expect(matchesHostPattern("10.255.255.254", ["10.0.0.0/8"])).toBe(true);
		expect(matchesHostPattern("11.0.0.1", ["10.0.0.0/8"])).toBe(false);
		expect(matchesHostPattern("192.168.1.42", ["192.168.0.0/16"])).toBe(true);
	});

	it("trims + lowercases pattern + host", () => {
		expect(matchesHostPattern("API.Example.COM", [" api.example.com "])).toBe(true);
	});

	it("multiple patterns — any match wins", () => {
		expect(matchesHostPattern("api.example.com", ["localhost", "10.0.0.0/8", ".example.com"])).toBe(
			true,
		);
	});

	it("IPv6 falls back to exact-string match", () => {
		expect(matchesHostPattern("::1", ["::1"])).toBe(true);
		expect(matchesHostPattern("fe80::1", ["::1"])).toBe(false);
	});
});

describe("isValidHostPattern — grammar acceptance", () => {
	it("accepts `*`", () => {
		expect(isValidHostPattern("*")).toBe(true);
	});

	it("accepts plain hostnames", () => {
		expect(isValidHostPattern("example.com")).toBe(true);
		expect(isValidHostPattern("localhost")).toBe(true);
		expect(isValidHostPattern("a.b.c.d.e.example.com")).toBe(true);
	});

	it("accepts leading-dot suffix", () => {
		expect(isValidHostPattern(".example.com")).toBe(true);
	});

	it("accepts leading-star glob", () => {
		expect(isValidHostPattern("*.example.com")).toBe(true);
	});

	it("accepts IPv4 literal", () => {
		expect(isValidHostPattern("10.0.0.1")).toBe(true);
	});

	it("accepts IPv4 CIDR /0..32", () => {
		expect(isValidHostPattern("10.0.0.0/8")).toBe(true);
		expect(isValidHostPattern("0.0.0.0/0")).toBe(true);
		expect(isValidHostPattern("10.1.2.3/32")).toBe(true);
	});

	it("rejects trailing dot", () => {
		expect(isValidHostPattern("example.com.")).toBe(false);
	});

	it("rejects garbage", () => {
		expect(isValidHostPattern("??garbage??")).toBe(false);
		expect(isValidHostPattern("")).toBe(false);
	});

	it("rejects invalid CIDR prefix", () => {
		expect(isValidHostPattern("10.0.0.0/99")).toBe(false);
		expect(isValidHostPattern("10.0.0.0/")).toBe(false);
	});
});
