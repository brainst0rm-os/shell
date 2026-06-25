import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	DEFAULT_OFF_PRIVACY,
	DEFAULT_ON_PRIVACY,
	PreviewBlockedReason,
	PrivacyConfigError,
	PrivacyMode,
	defaultPrivacyConfigForPath,
	defaultVaultNetworkSettings,
	isPreviewAllowed,
	isPrivacyStrictPath,
	matchesAllowlist,
	validatePrivacyConfig,
	validateVaultNetworkSettings,
} from "./privacy-config";
import { ProxyConfigError, ProxyMode } from "./proxy-config";

describe("validatePrivacyConfig — discriminator + per-mode shape", () => {
	it("rejects non-object input", () => {
		expect(validatePrivacyConfig(null)).toMatchObject({
			ok: false,
			error: PrivacyConfigError.MissingMode,
		});
		expect(validatePrivacyConfig("on")).toMatchObject({
			ok: false,
			error: PrivacyConfigError.MissingMode,
		});
		expect(validatePrivacyConfig([])).toMatchObject({
			ok: false,
			error: PrivacyConfigError.MissingMode,
		});
	});

	it("rejects missing mode", () => {
		expect(validatePrivacyConfig({})).toMatchObject({
			ok: false,
			error: PrivacyConfigError.MissingMode,
		});
		expect(validatePrivacyConfig({ mode: "" })).toMatchObject({
			ok: false,
			error: PrivacyConfigError.MissingMode,
		});
	});

	it("rejects unknown mode", () => {
		expect(validatePrivacyConfig({ mode: "everywhere" })).toMatchObject({
			ok: false,
			error: PrivacyConfigError.InvalidMode,
		});
	});

	it("accepts Off (no extra fields)", () => {
		expect(validatePrivacyConfig({ mode: PrivacyMode.Off })).toEqual({
			ok: true,
			config: { mode: PrivacyMode.Off },
		});
	});

	it("accepts On (no extra fields)", () => {
		expect(validatePrivacyConfig({ mode: PrivacyMode.On })).toEqual({
			ok: true,
			config: { mode: PrivacyMode.On },
		});
	});

	it("accepts Manual (no extra fields)", () => {
		expect(validatePrivacyConfig({ mode: PrivacyMode.Manual })).toEqual({
			ok: true,
			config: { mode: PrivacyMode.Manual },
		});
	});

	it("DEFAULT_ON_PRIVACY is On", () => {
		expect(DEFAULT_ON_PRIVACY).toEqual({ mode: PrivacyMode.On });
	});

	it("DEFAULT_OFF_PRIVACY is Off", () => {
		expect(DEFAULT_OFF_PRIVACY).toEqual({ mode: PrivacyMode.Off });
	});
});

describe("validatePrivacyConfig — Allowlist", () => {
	it("accepts a list of valid host patterns", () => {
		const result = validatePrivacyConfig({
			mode: PrivacyMode.Allowlist,
			hosts: ["example.com", ".internal", "10.0.0.0/8", "*.team.example"],
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok");
		expect(result.config.mode).toBe(PrivacyMode.Allowlist);
		if (result.config.mode !== PrivacyMode.Allowlist) throw new Error("expected allowlist");
		expect(result.config.hosts).toEqual(["example.com", ".internal", "10.0.0.0/8", "*.team.example"]);
	});

	it("rejects missing hosts field", () => {
		expect(validatePrivacyConfig({ mode: PrivacyMode.Allowlist })).toMatchObject({
			ok: false,
			error: PrivacyConfigError.MissingAllowlist,
		});
	});

	it("rejects non-array hosts", () => {
		expect(
			validatePrivacyConfig({ mode: PrivacyMode.Allowlist, hosts: "example.com" }),
		).toMatchObject({
			ok: false,
			error: PrivacyConfigError.MalformedAllowlistEntry,
		});
	});

	it("rejects empty allowlist entry", () => {
		expect(
			validatePrivacyConfig({ mode: PrivacyMode.Allowlist, hosts: ["example.com", ""] }),
		).toMatchObject({
			ok: false,
			error: PrivacyConfigError.MalformedAllowlistEntry,
		});
	});

	it("rejects non-string allowlist entry", () => {
		expect(
			validatePrivacyConfig({ mode: PrivacyMode.Allowlist, hosts: ["example.com", 42] }),
		).toMatchObject({
			ok: false,
			error: PrivacyConfigError.MalformedAllowlistEntry,
		});
	});

	it("rejects malformed host pattern", () => {
		expect(
			validatePrivacyConfig({ mode: PrivacyMode.Allowlist, hosts: ["??garbage??"] }),
		).toMatchObject({
			ok: false,
			error: PrivacyConfigError.MalformedAllowlistEntry,
		});
		expect(
			validatePrivacyConfig({ mode: PrivacyMode.Allowlist, hosts: ["10.0.0.0/99"] }),
		).toMatchObject({
			ok: false,
			error: PrivacyConfigError.MalformedAllowlistEntry,
		});
	});

	it("accepts an empty allowlist (everything blocked, but valid)", () => {
		const result = validatePrivacyConfig({ mode: PrivacyMode.Allowlist, hosts: [] });
		expect(result.ok).toBe(true);
	});
});

describe("validateVaultNetworkSettings — composite", () => {
	it("rejects non-object", () => {
		expect(validateVaultNetworkSettings(null)).toMatchObject({
			ok: false,
			error: PrivacyConfigError.MalformedShape,
		});
	});

	it("accepts privacy + no proxy override", () => {
		const result = validateVaultNetworkSettings({
			privacy: { mode: PrivacyMode.On },
			proxyOverride: null,
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok");
		expect(result.settings.privacy).toEqual({ mode: PrivacyMode.On });
		expect(result.settings.proxyOverride).toBeNull();
	});

	it("accepts privacy + manual proxy override", () => {
		const result = validateVaultNetworkSettings({
			privacy: { mode: PrivacyMode.Off },
			proxyOverride: {
				mode: ProxyMode.Manual,
				httpsProxy: { host: "work.proxy", port: 3128 },
				noProxy: [".internal"],
			},
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok");
		expect(result.settings.proxyOverride?.mode).toBe(ProxyMode.Manual);
	});

	it("treats undefined proxyOverride as null", () => {
		const result = validateVaultNetworkSettings({ privacy: { mode: PrivacyMode.On } });
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok");
		expect(result.settings.proxyOverride).toBeNull();
	});

	it("surfaces the proxy validator's error variant when proxyOverride is malformed", () => {
		const result = validateVaultNetworkSettings({
			privacy: { mode: PrivacyMode.On },
			proxyOverride: { mode: "tunnel" },
		});
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected fail");
		expect(result.error).toBe(ProxyConfigError.InvalidMode);
	});

	it("surfaces the privacy validator's error variant when privacy is malformed", () => {
		const result = validateVaultNetworkSettings({
			privacy: { mode: "weird" },
			proxyOverride: null,
		});
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected fail");
		expect(result.error).toBe(PrivacyConfigError.InvalidMode);
	});
});

describe("matchesAllowlist — table", () => {
	it("empty list → false", () => {
		expect(matchesAllowlist("example.com", [])).toBe(false);
	});

	it("exact match", () => {
		expect(matchesAllowlist("example.com", ["example.com"])).toBe(true);
	});

	it("leading-dot suffix matches subdomain + base", () => {
		expect(matchesAllowlist("api.example.com", [".example.com"])).toBe(true);
		expect(matchesAllowlist("example.com", [".example.com"])).toBe(true);
	});

	it("`*` matches everything", () => {
		expect(matchesAllowlist("anywhere.example", ["*"])).toBe(true);
	});

	it("CIDR matches", () => {
		expect(matchesAllowlist("10.0.0.42", ["10.0.0.0/8"])).toBe(true);
	});

	it("non-match → false", () => {
		expect(matchesAllowlist("example.net", ["example.com"])).toBe(false);
	});
});

describe("isPrivacyStrictPath — OQ-163 detector", () => {
	const ORIGINAL_HOME = process.env.HOME;
	const ORIGINAL_USERPROFILE = process.env.USERPROFILE;

	beforeEach(() => {
		process.env.HOME = "/Users/test";
		process.env.USERPROFILE = "C:\\Users\\test";
	});

	afterEach(() => {
		process.env.HOME = ORIGINAL_HOME;
		process.env.USERPROFILE = ORIGINAL_USERPROFILE;
	});

	it("returns false for empty / non-string input", () => {
		expect(isPrivacyStrictPath("")).toBe(false);
		expect(isPrivacyStrictPath(undefined as unknown as string)).toBe(false);
	});

	it("normal vault paths → false", () => {
		expect(isPrivacyStrictPath("/Users/test/Brainstorm/Vault")).toBe(false);
		expect(isPrivacyStrictPath("/Users/test/Documents/Work/Vault")).toBe(false);
		expect(isPrivacyStrictPath("C:\\Users\\test\\Documents\\MyVault")).toBe(false);
	});

	it("segment named `Private` → true (POSIX)", () => {
		expect(isPrivacyStrictPath("/Users/test/Private/Vault")).toBe(true);
		expect(isPrivacyStrictPath("/var/Private/Vault")).toBe(true);
	});

	it("segment named `Private` → true (Windows)", () => {
		expect(isPrivacyStrictPath("C:\\Users\\test\\Private\\Vault")).toBe(true);
	});

	it("segment named `Privacy` / `Secure` / `Confidential` → true (case-insensitive)", () => {
		expect(isPrivacyStrictPath("/Users/test/Privacy/Vault")).toBe(true);
		expect(isPrivacyStrictPath("/Users/test/secure/Vault")).toBe(true);
		expect(isPrivacyStrictPath("/Users/test/Confidential/Vault")).toBe(true);
	});

	it("segment matching `*-secure*` or `*-private*` → true", () => {
		expect(isPrivacyStrictPath("/Users/test/work-secure-vault/Vault")).toBe(true);
		expect(isPrivacyStrictPath("/Users/test/personal-private-2026")).toBe(true);
		expect(isPrivacyStrictPath("/Users/test/foo-SECURE")).toBe(true);
	});

	it("`secure-vault` (no left-side char before `-secure`) → false; `securitas-vault` → false", () => {
		// `*-secure*` needs at least one char to the left of `-secure`.
		expect(isPrivacyStrictPath("/Users/test/secure-vault")).toBe(false);
		expect(isPrivacyStrictPath("/Users/test/securitas-vault")).toBe(false);
	});

	it("`~/Private/<vault>` shape → true", () => {
		expect(isPrivacyStrictPath("/Users/test/Private/Vault")).toBe(true);
	});

	it("`~/Documents/Private/<vault>` shape → true", () => {
		expect(isPrivacyStrictPath("/Users/test/Documents/Private/Vault")).toBe(true);
	});

	it("Windows USERPROFILE-relative Private/ → true", () => {
		expect(isPrivacyStrictPath("C:\\Users\\test\\Private\\Vault")).toBe(true);
	});

	it("paths above home / unrelated → false", () => {
		expect(isPrivacyStrictPath("/etc/Vault")).toBe(false);
		expect(isPrivacyStrictPath("/Users/test/Documents/MyVault")).toBe(false);
	});
});

describe("defaultPrivacyConfigForPath", () => {
	const ORIGINAL_HOME = process.env.HOME;
	beforeEach(() => {
		process.env.HOME = "/Users/test";
	});
	afterEach(() => {
		process.env.HOME = ORIGINAL_HOME;
	});

	it("returns Off for privacy-strict paths", () => {
		expect(defaultPrivacyConfigForPath("/Users/test/Private/Vault")).toEqual({
			mode: PrivacyMode.Off,
		});
	});

	it("returns On for normal paths", () => {
		expect(defaultPrivacyConfigForPath("/Users/test/Brainstorm/Vault")).toEqual({
			mode: PrivacyMode.On,
		});
	});
});

describe("defaultVaultNetworkSettings", () => {
	const ORIGINAL_HOME = process.env.HOME;
	beforeEach(() => {
		process.env.HOME = "/Users/test";
	});
	afterEach(() => {
		process.env.HOME = ORIGINAL_HOME;
	});

	it("wraps the privacy default + null proxy override", () => {
		expect(defaultVaultNetworkSettings("/Users/test/Brainstorm/Vault")).toEqual({
			privacy: { mode: PrivacyMode.On },
			proxyOverride: null,
		});
		expect(defaultVaultNetworkSettings("/Users/test/Private/Vault")).toEqual({
			privacy: { mode: PrivacyMode.Off },
			proxyOverride: null,
		});
	});
});

describe("isPreviewAllowed — per-mode", () => {
	it("Off → blocked, reason privacy-off", () => {
		expect(isPreviewAllowed({ mode: PrivacyMode.Off }, "https://example.com/")).toEqual({
			allowed: false,
			reason: PreviewBlockedReason.PrivacyOff,
		});
	});

	it("On → allowed", () => {
		expect(isPreviewAllowed({ mode: PrivacyMode.On }, "https://example.com/")).toEqual({
			allowed: true,
		});
	});

	it("Manual → blocked, reason privacy-manual", () => {
		expect(isPreviewAllowed({ mode: PrivacyMode.Manual }, "https://example.com/")).toEqual({
			allowed: false,
			reason: PreviewBlockedReason.PrivacyManual,
		});
	});

	it("Allowlist hit → allowed", () => {
		expect(
			isPreviewAllowed(
				{ mode: PrivacyMode.Allowlist, hosts: [".example.com"] },
				"https://api.example.com/article",
			),
		).toEqual({ allowed: true });
	});

	it("Allowlist miss → blocked, reason privacy-allowlist-miss", () => {
		expect(
			isPreviewAllowed(
				{ mode: PrivacyMode.Allowlist, hosts: [".example.com"] },
				"https://other.net/article",
			),
		).toEqual({ allowed: false, reason: PreviewBlockedReason.PrivacyAllowlistMiss });
	});

	it("Allowlist with malformed URL → blocked", () => {
		expect(isPreviewAllowed({ mode: PrivacyMode.Allowlist, hosts: ["*"] }, "not a url")).toEqual({
			allowed: false,
			reason: PreviewBlockedReason.PrivacyAllowlistMiss,
		});
	});
});
