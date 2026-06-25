import { describe, expect, it } from "vitest";
import { normalizeEgressOrigin } from "./ledger-handlers";

describe("normalizeEgressOrigin (11b.8b egress allowlist)", () => {
	it("defaults a bare host to https and returns the canonical origin", () => {
		expect(normalizeEgressOrigin("api.example.com")).toBe("https://api.example.com");
		expect(normalizeEgressOrigin("  api.example.com  ")).toBe("https://api.example.com");
	});

	it("preserves an explicit scheme + port", () => {
		expect(normalizeEgressOrigin("http://localhost:3000")).toBe("http://localhost:3000");
		expect(normalizeEgressOrigin("https://api.example.com:8443/v1/path")).toBe(
			"https://api.example.com:8443",
		);
	});

	it("REFUSES a wildcard (the per-origin allowlist never grants `*`)", () => {
		expect(normalizeEgressOrigin("*")).toBeNull();
		expect(normalizeEgressOrigin("*.example.com")).toBeNull();
		expect(normalizeEgressOrigin("https://*.example.com")).toBeNull();
	});

	it("refuses non-http(s) schemes and junk", () => {
		expect(normalizeEgressOrigin("file:///etc/passwd")).toBeNull();
		expect(normalizeEgressOrigin("ftp://example.com")).toBeNull();
		expect(normalizeEgressOrigin("javascript:alert(1)")).toBeNull();
		expect(normalizeEgressOrigin("")).toBeNull();
		expect(normalizeEgressOrigin("   ")).toBeNull();
		expect(normalizeEgressOrigin(42)).toBeNull();
		expect(normalizeEgressOrigin(null)).toBeNull();
	});
});
