import { describe, expect, it } from "vitest";
import {
	buildAuthorizationUrl,
	computeCodeChallenge,
	generateCodeVerifier,
	generateState,
} from "./oauth-pkce";

describe("oauth-pkce", () => {
	it("computes the RFC 7636 Appendix-B S256 challenge", () => {
		// The canonical vector from RFC 7636 §Appendix B.
		expect(computeCodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
			"E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
		);
	});

	it("generates a verifier in the RFC 43–128 char base64url range", () => {
		const v = generateCodeVerifier();
		expect(v).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(generateCodeVerifier()).not.toBe(v);
	});

	it("generates distinct state nonces", () => {
		expect(generateState()).not.toBe(generateState());
	});

	it("builds an S256 authorization URL with all required params", () => {
		const url = new URL(
			buildAuthorizationUrl({
				authorizeUrl: "https://github.com/login/oauth/authorize",
				clientId: "abc",
				redirectUri: "http://127.0.0.1:54321/callback",
				scopes: ["repo", "read:user"],
				state: "state123",
				codeChallenge: "chal",
				extraParams: { access_type: "offline" },
			}),
		);
		expect(url.searchParams.get("response_type")).toBe("code");
		expect(url.searchParams.get("client_id")).toBe("abc");
		expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:54321/callback");
		expect(url.searchParams.get("scope")).toBe("repo read:user");
		expect(url.searchParams.get("state")).toBe("state123");
		expect(url.searchParams.get("code_challenge")).toBe("chal");
		expect(url.searchParams.get("code_challenge_method")).toBe("S256");
		expect(url.searchParams.get("access_type")).toBe("offline");
	});
});
