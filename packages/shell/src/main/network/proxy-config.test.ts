import { describe, expect, it } from "vitest";
import {
	DEFAULT_PROXY_CONFIG,
	EffectiveProxyKind,
	type ManualProxyConfig,
	ProxyConfigError,
	ProxyMode,
	ProxyResolutionError,
	ProxyResolutionErrorKind,
	matchesNoProxy,
	resolveEffectiveProxy,
	validateProxyConfig,
} from "./proxy-config";

describe("validateProxyConfig — discriminator + per-mode shape", () => {
	it("rejects non-object input", () => {
		expect(validateProxyConfig(null)).toMatchObject({
			ok: false,
			error: ProxyConfigError.MissingMode,
		});
		expect(validateProxyConfig("manual")).toMatchObject({
			ok: false,
			error: ProxyConfigError.MissingMode,
		});
		expect(validateProxyConfig([])).toMatchObject({
			ok: false,
			error: ProxyConfigError.MissingMode,
		});
	});

	it("rejects missing mode", () => {
		expect(validateProxyConfig({})).toMatchObject({
			ok: false,
			error: ProxyConfigError.MissingMode,
		});
		expect(validateProxyConfig({ mode: "" })).toMatchObject({
			ok: false,
			error: ProxyConfigError.MissingMode,
		});
	});

	it("rejects unknown mode", () => {
		expect(validateProxyConfig({ mode: "tunnel" })).toMatchObject({
			ok: false,
			error: ProxyConfigError.InvalidMode,
		});
	});

	it("accepts Direct mode (no other fields)", () => {
		const result = validateProxyConfig({ mode: ProxyMode.Direct });
		expect(result).toEqual({ ok: true, config: { mode: ProxyMode.Direct } });
	});

	it("accepts System mode (no other fields)", () => {
		const result = validateProxyConfig({ mode: ProxyMode.System });
		expect(result).toEqual({ ok: true, config: { mode: ProxyMode.System } });
	});

	it("DEFAULT_PROXY_CONFIG is System", () => {
		expect(DEFAULT_PROXY_CONFIG).toEqual({ mode: ProxyMode.System });
	});
});

describe("validateProxyConfig — Manual", () => {
	it("accepts an http endpoint with port", () => {
		const result = validateProxyConfig({
			mode: ProxyMode.Manual,
			httpProxy: { host: "proxy.corp", port: 3128 },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok");
		expect(result.config.mode).toBe(ProxyMode.Manual);
		const config = result.config as ManualProxyConfig;
		expect(config.httpProxy).toEqual({ host: "proxy.corp", port: 3128 });
		expect(config.noProxy).toEqual([]);
	});

	it("accepts a full triple + noProxy list + authKey", () => {
		const result = validateProxyConfig({
			mode: ProxyMode.Manual,
			httpProxy: { host: "proxy.corp", port: 80, authKey: "proxy.corp:80" },
			httpsProxy: { host: "proxy.corp", port: 443 },
			socks5Proxy: { host: "10.0.0.1", port: 1080 },
			noProxy: ["localhost", ".example.com", "10.0.0.0/8"],
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok");
		const config = result.config as ManualProxyConfig;
		expect(config.httpProxy?.authKey).toBe("proxy.corp:80");
		expect(config.noProxy).toEqual(["localhost", ".example.com", "10.0.0.0/8"]);
	});

	it("rejects endpoint with empty host", () => {
		expect(
			validateProxyConfig({
				mode: ProxyMode.Manual,
				httpProxy: { host: "", port: 3128 },
			}),
		).toMatchObject({ ok: false, error: ProxyConfigError.EmptyHost });
	});

	it("rejects endpoint with non-integer port", () => {
		expect(
			validateProxyConfig({
				mode: ProxyMode.Manual,
				httpProxy: { host: "proxy", port: 3128.5 },
			}),
		).toMatchObject({ ok: false, error: ProxyConfigError.InvalidPort });
	});

	it("rejects endpoint with port out of range", () => {
		expect(
			validateProxyConfig({
				mode: ProxyMode.Manual,
				httpProxy: { host: "proxy", port: 0 },
			}),
		).toMatchObject({ ok: false, error: ProxyConfigError.InvalidPort });
		expect(
			validateProxyConfig({
				mode: ProxyMode.Manual,
				httpProxy: { host: "proxy", port: 70_000 },
			}),
		).toMatchObject({ ok: false, error: ProxyConfigError.InvalidPort });
	});

	it("rejects endpoint missing port", () => {
		expect(
			validateProxyConfig({
				mode: ProxyMode.Manual,
				httpProxy: { host: "proxy" },
			}),
		).toMatchObject({ ok: false, error: ProxyConfigError.InvalidPort });
	});

	it("rejects malformed endpoint shape", () => {
		expect(
			validateProxyConfig({
				mode: ProxyMode.Manual,
				httpProxy: "broken",
			}),
		).toMatchObject({ ok: false, error: ProxyConfigError.MalformedEndpoint });
		expect(
			validateProxyConfig({
				mode: ProxyMode.Manual,
				httpProxy: ["broken"],
			}),
		).toMatchObject({ ok: false, error: ProxyConfigError.MalformedEndpoint });
	});

	it("rejects empty authKey when present", () => {
		expect(
			validateProxyConfig({
				mode: ProxyMode.Manual,
				httpProxy: { host: "proxy", port: 80, authKey: "" },
			}),
		).toMatchObject({ ok: false, error: ProxyConfigError.MalformedEndpoint });
	});

	it("rejects non-array noProxy", () => {
		expect(
			validateProxyConfig({
				mode: ProxyMode.Manual,
				noProxy: "localhost",
			}),
		).toMatchObject({ ok: false, error: ProxyConfigError.MalformedNoProxyPattern });
	});

	it("rejects empty noProxy entry", () => {
		expect(
			validateProxyConfig({
				mode: ProxyMode.Manual,
				noProxy: ["localhost", ""],
			}),
		).toMatchObject({ ok: false, error: ProxyConfigError.MalformedNoProxyPattern });
	});

	it("rejects malformed noProxy pattern", () => {
		expect(
			validateProxyConfig({
				mode: ProxyMode.Manual,
				noProxy: ["??garbage??"],
			}),
		).toMatchObject({ ok: false, error: ProxyConfigError.MalformedNoProxyPattern });
		// Invalid CIDR prefix
		expect(
			validateProxyConfig({
				mode: ProxyMode.Manual,
				noProxy: ["10.0.0.0/99"],
			}),
		).toMatchObject({ ok: false, error: ProxyConfigError.MalformedNoProxyPattern });
	});
});

describe("validateProxyConfig — PAC", () => {
	it("accepts an http: PAC URL", () => {
		const result = validateProxyConfig({
			mode: ProxyMode.Pac,
			pacUrl: "http://wpad.corp/proxy.pac",
		});
		expect(result).toEqual({
			ok: true,
			config: { mode: ProxyMode.Pac, pacUrl: "http://wpad.corp/proxy.pac" },
		});
	});

	it("accepts an https: PAC URL", () => {
		const result = validateProxyConfig({
			mode: ProxyMode.Pac,
			pacUrl: "https://wpad.example.com/proxy.pac",
		});
		expect(result.ok).toBe(true);
	});

	it("accepts a file: PAC URL", () => {
		const result = validateProxyConfig({
			mode: ProxyMode.Pac,
			pacUrl: "file:///etc/proxy.pac",
		});
		expect(result.ok).toBe(true);
	});

	it("rejects missing pacUrl", () => {
		expect(validateProxyConfig({ mode: ProxyMode.Pac })).toMatchObject({
			ok: false,
			error: ProxyConfigError.MissingPacUrl,
		});
	});

	it("rejects empty pacUrl", () => {
		expect(validateProxyConfig({ mode: ProxyMode.Pac, pacUrl: "" })).toMatchObject({
			ok: false,
			error: ProxyConfigError.MissingPacUrl,
		});
	});

	it("rejects malformed pacUrl", () => {
		expect(validateProxyConfig({ mode: ProxyMode.Pac, pacUrl: "not a url" })).toMatchObject({
			ok: false,
			error: ProxyConfigError.MalformedPacUrl,
		});
	});

	it("rejects non-http/https/file PAC scheme", () => {
		expect(validateProxyConfig({ mode: ProxyMode.Pac, pacUrl: "javascript:alert(1)" })).toMatchObject(
			{
				ok: false,
				error: ProxyConfigError.MalformedPacUrl,
			},
		);
		expect(
			validateProxyConfig({ mode: ProxyMode.Pac, pacUrl: "ftp://wpad/proxy.pac" }),
		).toMatchObject({
			ok: false,
			error: ProxyConfigError.MalformedPacUrl,
		});
	});
});

describe("matchesNoProxy", () => {
	it("empty patterns → no match", () => {
		expect(matchesNoProxy("api.example.com", [])).toBe(false);
	});

	it("`*` matches everything", () => {
		expect(matchesNoProxy("api.example.com", ["*"])).toBe(true);
		expect(matchesNoProxy("8.8.8.8", ["*"])).toBe(true);
	});

	it("exact hostname match", () => {
		expect(matchesNoProxy("api.example.com", ["api.example.com"])).toBe(true);
		expect(matchesNoProxy("OTHER.example.com", ["other.example.com"])).toBe(true);
		expect(matchesNoProxy("api.example.com", ["api.example.net"])).toBe(false);
	});

	it("leading-dot suffix matches subdomain AND base", () => {
		expect(matchesNoProxy("api.example.com", [".example.com"])).toBe(true);
		expect(matchesNoProxy("example.com", [".example.com"])).toBe(true);
		expect(matchesNoProxy("deep.api.example.com", [".example.com"])).toBe(true);
		expect(matchesNoProxy("example.net", [".example.com"])).toBe(false);
	});

	it("leading-star matches subdomains only, not the base", () => {
		expect(matchesNoProxy("api.example.com", ["*.example.com"])).toBe(true);
		expect(matchesNoProxy("deep.api.example.com", ["*.example.com"])).toBe(true);
		expect(matchesNoProxy("example.com", ["*.example.com"])).toBe(false);
	});

	it("CIDR matches IPv4 in range", () => {
		expect(matchesNoProxy("10.0.0.1", ["10.0.0.0/8"])).toBe(true);
		expect(matchesNoProxy("10.255.255.254", ["10.0.0.0/8"])).toBe(true);
		expect(matchesNoProxy("11.0.0.1", ["10.0.0.0/8"])).toBe(false);
		expect(matchesNoProxy("192.168.1.42", ["192.168.0.0/16"])).toBe(true);
		expect(matchesNoProxy("192.169.1.42", ["192.168.0.0/16"])).toBe(false);
	});

	it("CIDR /32 matches a single IP exactly", () => {
		expect(matchesNoProxy("10.1.2.3", ["10.1.2.3/32"])).toBe(true);
		expect(matchesNoProxy("10.1.2.4", ["10.1.2.3/32"])).toBe(false);
	});

	it("CIDR /0 matches everything (as an IPv4)", () => {
		expect(matchesNoProxy("8.8.8.8", ["0.0.0.0/0"])).toBe(true);
	});

	it("CIDR does not match hostnames", () => {
		expect(matchesNoProxy("api.example.com", ["10.0.0.0/8"])).toBe(false);
	});

	it("IPv6 falls back to exact-string match (no full IPv6 CIDR v1)", () => {
		expect(matchesNoProxy("::1", ["::1"])).toBe(true);
		expect(matchesNoProxy("fe80::1", ["::1"])).toBe(false);
	});

	it("trims + lowercases pattern + host before comparing", () => {
		expect(matchesNoProxy("API.Example.COM", [" api.example.com "])).toBe(true);
	});

	it("multiple patterns — any match wins", () => {
		expect(matchesNoProxy("api.example.com", ["localhost", "10.0.0.0/8", ".example.com"])).toBe(true);
	});

	it("trailing-dot pattern is rejected by validator (sanity — matcher never receives it)", () => {
		// Validator-level guarantee: trailing-dot patterns refuse validation,
		// so a downstream call to matchesNoProxy with that pattern shape
		// shouldn't happen in production. Sanity-asserted via the validator.
		expect(
			validateProxyConfig({
				mode: ProxyMode.Manual,
				noProxy: ["example.com."],
			}),
		).toMatchObject({ ok: false, error: ProxyConfigError.MalformedNoProxyPattern });
	});
});

describe("resolveEffectiveProxy — per-mode resolution", () => {
	it("Direct → direct", () => {
		expect(resolveEffectiveProxy({ mode: ProxyMode.Direct }, "https://example.com/")).toEqual({
			kind: EffectiveProxyKind.Direct,
		});
	});

	it("System → deferred", () => {
		const result = resolveEffectiveProxy({ mode: ProxyMode.System }, "https://example.com/");
		expect(result.kind).toBe(EffectiveProxyKind.Deferred);
	});

	it("PAC → deferred", () => {
		const result = resolveEffectiveProxy(
			{ mode: ProxyMode.Pac, pacUrl: "http://wpad/proxy.pac" },
			"https://example.com/",
		);
		expect(result.kind).toBe(EffectiveProxyKind.Deferred);
	});

	it("Manual https → https endpoint", () => {
		const result = resolveEffectiveProxy(
			{
				mode: ProxyMode.Manual,
				httpsProxy: { host: "proxy.corp", port: 443 },
				noProxy: [],
			},
			"https://example.com/",
		);
		expect(result).toMatchObject({
			kind: EffectiveProxyKind.Https,
			host: "proxy.corp",
			port: 443,
		});
	});

	it("Manual http → http endpoint", () => {
		const result = resolveEffectiveProxy(
			{
				mode: ProxyMode.Manual,
				httpProxy: { host: "proxy.corp", port: 80 },
				noProxy: [],
			},
			"http://example.com/",
		);
		expect(result).toMatchObject({
			kind: EffectiveProxyKind.Http,
			host: "proxy.corp",
			port: 80,
		});
	});

	it("Manual + scheme not configured → falls through to socks5", () => {
		const result = resolveEffectiveProxy(
			{
				mode: ProxyMode.Manual,
				socks5Proxy: { host: "10.0.0.1", port: 1080 },
				noProxy: [],
			},
			"https://example.com/",
		);
		expect(result).toMatchObject({
			kind: EffectiveProxyKind.Socks5,
			host: "10.0.0.1",
			port: 1080,
		});
	});

	it("Manual + scheme not configured + no socks5 → direct", () => {
		expect(
			resolveEffectiveProxy({ mode: ProxyMode.Manual, noProxy: [] }, "https://example.com/"),
		).toEqual({ kind: EffectiveProxyKind.Direct });
	});

	it("Manual + noProxy match → direct (bypasses configured proxy)", () => {
		expect(
			resolveEffectiveProxy(
				{
					mode: ProxyMode.Manual,
					httpsProxy: { host: "proxy.corp", port: 443 },
					noProxy: [".example.com"],
				},
				"https://api.example.com/",
			),
		).toEqual({ kind: EffectiveProxyKind.Direct });
	});

	it("Manual + authKey survives the resolve", () => {
		const result = resolveEffectiveProxy(
			{
				mode: ProxyMode.Manual,
				httpsProxy: { host: "proxy.corp", port: 443, authKey: "proxy.corp:443" },
				noProxy: [],
			},
			"https://example.com/",
		);
		expect(result).toMatchObject({
			kind: EffectiveProxyKind.Https,
			host: "proxy.corp",
			port: 443,
			authKey: "proxy.corp:443",
		});
	});

	it("Manual + malformed URL → direct (broker's SSRF guard catches it)", () => {
		expect(
			resolveEffectiveProxy(
				{
					mode: ProxyMode.Manual,
					httpsProxy: { host: "proxy.corp", port: 443 },
					noProxy: [],
				},
				"not a url",
			),
		).toEqual({ kind: EffectiveProxyKind.Direct });
	});
});

describe("ProxyResolutionError", () => {
	it("has the right shape + kinds", () => {
		const err = new ProxyResolutionError(ProxyResolutionErrorKind.Unreachable, "connect timeout");
		expect(err.name).toBe("ProxyResolutionError");
		expect(err.kind).toBe(ProxyResolutionErrorKind.Unreachable);
		expect(err.detail).toBe("connect timeout");
		expect(err.message).toContain("proxy-unreachable");
		expect(err.message).toContain("connect timeout");
	});

	it("covers every doc-38 §Failure-modes kind", () => {
		const kinds = [
			ProxyResolutionErrorKind.Unreachable,
			ProxyResolutionErrorKind.PacEvaluationFailed,
			ProxyResolutionErrorKind.AuthFailed,
			ProxyResolutionErrorKind.TlsHandshakeFailed,
		];
		for (const kind of kinds) {
			const err = new ProxyResolutionError(kind, "x");
			expect(err.kind).toBe(kind);
		}
	});
});
