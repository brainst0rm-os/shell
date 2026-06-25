import { describe, expect, it } from "vitest";
import { SsrfRejection, checkResolvedIp, checkUrl } from "./ssrf-guard";

describe("checkUrl — scheme + URL shape", () => {
	it("accepts a public HTTPS URL", () => {
		const result = checkUrl("https://example.com/some/path?q=1");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.hostname).toBe("example.com");
			expect(result.port).toBe(443);
			expect(result.canonicalUrl).toBe("https://example.com/some/path?q=1");
		}
	});

	it("accepts a public HTTP URL", () => {
		const result = checkUrl("http://example.com");
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.port).toBe(80);
	});

	it("accepts a custom-port HTTPS URL (8443) for self-hosted services", () => {
		const result = checkUrl("https://example.com:8443/api");
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.port).toBe(8443);
	});

	it("rejects empty input", () => {
		const result = checkUrl("");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe(SsrfRejection.MalformedUrl);
	});

	it("rejects malformed URL", () => {
		const result = checkUrl("not a url");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe(SsrfRejection.MalformedUrl);
	});

	it("rejects file:// URL", () => {
		const result = checkUrl("file:///etc/passwd");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe(SsrfRejection.NonHttpScheme);
	});

	it("rejects data: URL", () => {
		const result = checkUrl("data:text/plain;base64,aGVsbG8=");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe(SsrfRejection.NonHttpScheme);
	});

	it("rejects javascript: URL", () => {
		const result = checkUrl("javascript:alert(1)");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe(SsrfRejection.NonHttpScheme);
	});

	it("rejects ws:// URL", () => {
		const result = checkUrl("ws://example.com/socket");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe(SsrfRejection.NonHttpScheme);
	});

	it("rejects blob: URL", () => {
		const result = checkUrl("blob:https://example.com/uuid");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe(SsrfRejection.NonHttpScheme);
	});
});

describe("checkUrl — local-hostname conventions", () => {
	it("rejects localhost", () => {
		const result = checkUrl("https://localhost/anything");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe(SsrfRejection.LocalHostname);
	});

	it("rejects *.localhost (per RFC 6761)", () => {
		const result = checkUrl("https://foo.localhost");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe(SsrfRejection.LocalHostname);
	});

	it("rejects *.local (mDNS)", () => {
		const result = checkUrl("https://printer.local");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe(SsrfRejection.LocalHostname);
	});

	it("rejects ip6-localhost", () => {
		const result = checkUrl("http://ip6-localhost/");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe(SsrfRejection.LocalHostname);
	});

	it("is case-insensitive (LOCALHOST blocked too)", () => {
		const result = checkUrl("https://LOCALHOST/x");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe(SsrfRejection.LocalHostname);
	});

	it("accepts a hostname that has 'local' in the middle (not a suffix)", () => {
		const result = checkUrl("https://my-local-news.example.com");
		expect(result.ok).toBe(true);
	});
});

describe("checkUrl — blocked ports", () => {
	it("rejects port 22 (SSH)", () => {
		const result = checkUrl("https://example.com:22/");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe(SsrfRejection.BlockedPort);
	});

	it("rejects port 25 (SMTP)", () => {
		const result = checkUrl("http://example.com:25/");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe(SsrfRejection.BlockedPort);
	});

	it("rejects port 3306 (MySQL)", () => {
		const result = checkUrl("http://example.com:3306/");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe(SsrfRejection.BlockedPort);
	});

	it("rejects port 6379 (Redis)", () => {
		const result = checkUrl("http://example.com:6379/");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe(SsrfRejection.BlockedPort);
	});

	it("accepts port 8080", () => {
		const result = checkUrl("https://example.com:8080/api");
		expect(result.ok).toBe(true);
	});

	it("accepts port 3000 (Common dev server)", () => {
		const result = checkUrl("https://example.com:3000/");
		expect(result.ok).toBe(true);
	});
});

describe("checkUrl — literal IP hostnames are validated inline", () => {
	it("rejects http://127.0.0.1", () => {
		const result = checkUrl("http://127.0.0.1/admin");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe(SsrfRejection.PrivateIp);
	});

	it("rejects http://10.0.0.5", () => {
		const result = checkUrl("http://10.0.0.5/");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe(SsrfRejection.PrivateIp);
	});

	it("rejects http://169.254.169.254/ (AWS metadata)", () => {
		const result = checkUrl("http://169.254.169.254/latest/meta-data/iam/security-credentials/");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe(SsrfRejection.PrivateIp);
			expect(result.detail).toContain("169.254");
		}
	});

	it("rejects http://[::1]/", () => {
		const result = checkUrl("http://[::1]/");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe(SsrfRejection.PrivateIp);
	});

	it("rejects http://[fd00::1]/ (IPv6 unique local)", () => {
		const result = checkUrl("http://[fd00::1]/");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe(SsrfRejection.PrivateIp);
	});

	it("accepts public IPv4 (8.8.8.8)", () => {
		const result = checkUrl("https://8.8.8.8/api");
		expect(result.ok).toBe(true);
	});

	it("accepts public IPv6 (2001:4860:4860::8888 — Google DNS)", () => {
		const result = checkUrl("https://[2001:4860:4860::8888]/");
		expect(result.ok).toBe(true);
	});
});

describe("checkResolvedIp — IPv4 ranges", () => {
	it("rejects 0.0.0.0", () => {
		const result = checkResolvedIp("0.0.0.0");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe(SsrfRejection.PrivateIp);
	});

	it("rejects every octet in 10.0.0.0/8", () => {
		for (const ip of ["10.0.0.0", "10.1.2.3", "10.255.255.255"]) {
			const result = checkResolvedIp(ip);
			expect(result.ok, `${ip} should be blocked`).toBe(false);
		}
	});

	it("rejects 100.64.0.0/10 (CGNAT)", () => {
		expect(checkResolvedIp("100.64.0.0").ok).toBe(false);
		expect(checkResolvedIp("100.127.255.255").ok).toBe(false);
		// boundary: 100.63 is OK, 100.128 is OK
		expect(checkResolvedIp("100.63.0.0").ok).toBe(true);
		expect(checkResolvedIp("100.128.0.0").ok).toBe(true);
	});

	it("rejects 127.0.0.1 + entire 127/8", () => {
		expect(checkResolvedIp("127.0.0.1").ok).toBe(false);
		expect(checkResolvedIp("127.255.255.254").ok).toBe(false);
	});

	it("rejects 169.254.169.254 (cloud metadata)", () => {
		const result = checkResolvedIp("169.254.169.254");
		expect(result.ok).toBe(false);
	});

	it("rejects 172.16.0.0/12 boundaries", () => {
		expect(checkResolvedIp("172.16.0.0").ok).toBe(false);
		expect(checkResolvedIp("172.31.255.255").ok).toBe(false);
		expect(checkResolvedIp("172.15.255.255").ok).toBe(true);
		expect(checkResolvedIp("172.32.0.0").ok).toBe(true);
	});

	it("rejects 192.168.0.0/16", () => {
		expect(checkResolvedIp("192.168.0.0").ok).toBe(false);
		expect(checkResolvedIp("192.168.1.1").ok).toBe(false);
	});

	it("rejects 224.0.0.0/4 multicast", () => {
		expect(checkResolvedIp("224.0.0.1").ok).toBe(false);
		expect(checkResolvedIp("239.255.255.255").ok).toBe(false);
	});

	it("rejects 240.0.0.0/4 reserved", () => {
		expect(checkResolvedIp("240.0.0.0").ok).toBe(false);
		expect(checkResolvedIp("255.255.255.255").ok).toBe(false);
	});

	it("accepts 8.8.8.8 (public)", () => {
		const result = checkResolvedIp("8.8.8.8");
		expect(result.ok).toBe(true);
	});

	it("accepts 93.184.216.34 (example.com)", () => {
		const result = checkResolvedIp("93.184.216.34");
		expect(result.ok).toBe(true);
	});
});

describe("checkResolvedIp — IPv6 ranges", () => {
	it("rejects ::1 (loopback)", () => {
		const result = checkResolvedIp("::1");
		expect(result.ok).toBe(false);
	});

	it("rejects :: (unspecified)", () => {
		const result = checkResolvedIp("::");
		expect(result.ok).toBe(false);
	});

	it("rejects fe80:: link-local", () => {
		expect(checkResolvedIp("fe80::1").ok).toBe(false);
		expect(checkResolvedIp("febf:ffff::").ok).toBe(false);
	});

	it("rejects fc00::/7 unique local", () => {
		expect(checkResolvedIp("fc00::").ok).toBe(false);
		expect(checkResolvedIp("fd12:3456::").ok).toBe(false);
	});

	it("rejects ff00::/8 multicast", () => {
		expect(checkResolvedIp("ff02::1").ok).toBe(false);
	});

	it("rejects 2001:db8::/32 documentation", () => {
		expect(checkResolvedIp("2001:db8::1").ok).toBe(false);
	});

	it("rejects IPv4-mapped private (::ffff:10.0.0.1)", () => {
		const result = checkResolvedIp("::ffff:10.0.0.1");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.detail).toContain("IPv4-mapped");
	});

	it("accepts IPv4-mapped public (::ffff:8.8.8.8)", () => {
		const result = checkResolvedIp("::ffff:8.8.8.8");
		expect(result.ok).toBe(true);
	});

	it("accepts 2001:4860:4860::8888 (Google DNS)", () => {
		const result = checkResolvedIp("2001:4860:4860::8888");
		expect(result.ok).toBe(true);
	});

	it("accepts brackets-wrapped IPv6", () => {
		expect(checkResolvedIp("[::1]").ok).toBe(false);
		expect(checkResolvedIp("[2001:4860:4860::8888]").ok).toBe(true);
	});
});

describe("checkResolvedIp — malformed input", () => {
	it("rejects empty", () => {
		const result = checkResolvedIp("");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe(SsrfRejection.MalformedIp);
	});

	it("rejects garbage", () => {
		const result = checkResolvedIp("not.an.ip.address.really");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe(SsrfRejection.MalformedIp);
	});

	it("rejects out-of-range octet (10.0.0.256)", () => {
		const result = checkResolvedIp("10.0.0.256");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe(SsrfRejection.MalformedIp);
	});

	it("rejects IPv4 with too many parts", () => {
		expect(checkResolvedIp("1.2.3.4.5").ok).toBe(false);
	});

	it("rejects IPv6 with two '::'", () => {
		expect(checkResolvedIp("1::2::3").ok).toBe(false);
	});

	it("rejects IPv6 with too many groups", () => {
		expect(checkResolvedIp("1:2:3:4:5:6:7:8:9").ok).toBe(false);
	});
});

describe("checkUrl — IDN / punycode", () => {
	it("accepts punycoded ASCII form of an IDN public domain", () => {
		// xn--nxasmq6b is 'привет' but for test stability use a known
		// fixed-shape punycode that's a public hostname (none-local).
		// The WHATWG URL parser normalises IDN → punycode automatically.
		const result = checkUrl("https://例え.example/");
		expect(result.ok).toBe(true);
		if (result.ok) {
			// hostname is lower-cased + ASCII-punycoded
			expect(result.hostname).toMatch(/^xn--/);
			expect(result.hostname.endsWith(".example")).toBe(true);
		}
	});

	it("rejects a unicode hostname that punycodes to a *.local suffix", () => {
		// "ex.local" — already ASCII; the IDN path is tested by the URL
		// parser itself. This case ensures we re-check after normalisation.
		const result = checkUrl("https://ex.local/");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe(SsrfRejection.LocalHostname);
	});
});

/**
 * Net-1b — `.private` cap relaxations.
 *
 * `allowPrivate: true` flips the `LocalHostname` (pre-DNS) + `PrivateIp`
 * (post-DNS) rejections into accepts. The hard floor — non-HTTP scheme,
 * malformed URL, blocked port, IDN decode, malformed IP — is
 * unconditional; `.private` never relaxes it.
 */
describe("checkUrl — allowPrivate relaxes LocalHostname + PrivateIp literal", () => {
	it("accepts localhost when allowPrivate is true", () => {
		const r = checkUrl("http://localhost/", { allowPrivate: true });
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.hostname).toBe("localhost");
	});

	it("still rejects localhost without allowPrivate", () => {
		const r = checkUrl("http://localhost/");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.reason).toBe(SsrfRejection.LocalHostname);
	});

	it("accepts *.local mDNS when allowPrivate is true", () => {
		const r = checkUrl("http://printer.local/", { allowPrivate: true });
		expect(r.ok).toBe(true);
	});

	it("accepts a literal RFC1918 IP URL when allowPrivate is true", () => {
		const r = checkUrl("http://192.168.1.1/", { allowPrivate: true });
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.hostname).toBe("192.168.1.1");
	});

	it("accepts loopback IPv6 ::1 when allowPrivate is true", () => {
		const r = checkUrl("http://[::1]/", { allowPrivate: true });
		expect(r.ok).toBe(true);
	});

	it("still rejects javascript: scheme even with allowPrivate", () => {
		// Hard floor — `.private` never relaxes scheme rules.
		const r = checkUrl("javascript:alert(1)", { allowPrivate: true });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.reason).toBe(SsrfRejection.NonHttpScheme);
	});

	it("still rejects file: scheme even with allowPrivate", () => {
		const r = checkUrl("file:///etc/passwd", { allowPrivate: true });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.reason).toBe(SsrfRejection.NonHttpScheme);
	});

	it("still rejects blocked ports even with allowPrivate", () => {
		// SSH on a private IP must stay refused — `.private` is a network
		// reach widener, never a port-floor relaxer.
		const r = checkUrl("http://192.168.1.1:22/", { allowPrivate: true });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.reason).toBe(SsrfRejection.BlockedPort);
	});

	it("still rejects malformed URLs even with allowPrivate", () => {
		const r = checkUrl("not a url", { allowPrivate: true });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.reason).toBe(SsrfRejection.MalformedUrl);
	});
});

describe("checkResolvedIp — allowPrivate accepts PrivateIp classifications", () => {
	it("accepts 127.0.0.1 (loopback) when allowPrivate is true", () => {
		const r = checkResolvedIp("127.0.0.1", { allowPrivate: true });
		expect(r.ok).toBe(true);
	});

	it("accepts 10.0.0.1 (RFC1918 /8) when allowPrivate is true", () => {
		const r = checkResolvedIp("10.0.0.1", { allowPrivate: true });
		expect(r.ok).toBe(true);
	});

	it("accepts 192.168.1.1 (RFC1918 /16) when allowPrivate is true", () => {
		const r = checkResolvedIp("192.168.1.1", { allowPrivate: true });
		expect(r.ok).toBe(true);
	});

	it("accepts 169.254.169.254 (cloud metadata, link-local) when allowPrivate is true", () => {
		// Note: this is intentional — the `.private` cap is the user's
		// explicit consent to reach metadata services from app code.
		// Privacy-Strict mode (Net-1d per-vault setting) is the place
		// that hides this option from the user; the cap itself doesn't
		// distinguish.
		const r = checkResolvedIp("169.254.169.254", { allowPrivate: true });
		expect(r.ok).toBe(true);
	});

	it("accepts ::1 (IPv6 loopback) when allowPrivate is true", () => {
		const r = checkResolvedIp("::1", { allowPrivate: true });
		expect(r.ok).toBe(true);
	});

	it("accepts fc00::1 (IPv6 ULA) when allowPrivate is true", () => {
		const r = checkResolvedIp("fc00::1", { allowPrivate: true });
		expect(r.ok).toBe(true);
	});

	it("still rejects malformed IPs even with allowPrivate", () => {
		// Floor — `.private` only relaxes valid private IPs, never garbage.
		const r = checkResolvedIp("not.an.ip.address", { allowPrivate: true });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.reason).toBe(SsrfRejection.MalformedIp);
	});

	it("public IPs still pass without allowPrivate (no regression)", () => {
		const r = checkResolvedIp("8.8.8.8");
		expect(r.ok).toBe(true);
	});

	it("private IPs still rejected without allowPrivate (no regression)", () => {
		const r = checkResolvedIp("192.168.1.1");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.reason).toBe(SsrfRejection.PrivateIp);
	});
});
