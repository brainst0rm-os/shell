import { describe, expect, it } from "vitest";
import { customSchemeRedirectProvider, startLoopbackRedirect } from "./oauth-redirect";

async function hit(redirectUri: string, query: Record<string, string>): Promise<void> {
	const url = new URL(redirectUri);
	for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
	await fetch(url.toString());
}

describe("oauth-redirect — loopback", () => {
	it("binds 127.0.0.1 and resolves with the code on a matching state", async () => {
		const capture = await startLoopbackRedirect();
		expect(capture.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
		const codePromise = capture.waitForCode("state-xyz");
		await hit(capture.redirectUri, { code: "the-code", state: "state-xyz" });
		await expect(codePromise).resolves.toBe("the-code");
	});

	it("rejects on a state mismatch", async () => {
		const capture = await startLoopbackRedirect();
		const codePromise = capture.waitForCode("expected-state");
		await hit(capture.redirectUri, { code: "x", state: "attacker-state" });
		await expect(codePromise).rejects.toThrow(/state mismatch/);
	});

	it("times out and closes when no redirect arrives", async () => {
		const capture = await startLoopbackRedirect({ timeoutMs: 50 });
		await expect(capture.waitForCode("s")).rejects.toThrow(/timed out/);
	});

	it("handles a redirect that arrives before waitForCode is called", async () => {
		const capture = await startLoopbackRedirect();
		await hit(capture.redirectUri, { code: "early", state: "s1" });
		await new Promise((r) => setTimeout(r, 20));
		await expect(capture.waitForCode("s1")).resolves.toBe("early");
	});
});

describe("oauth-redirect — custom-scheme fallback", () => {
	it("is wired behind the same interface but not yet implemented", async () => {
		await expect(customSchemeRedirectProvider.start()).rejects.toThrow(/OQ-CN-2/);
	});
});
