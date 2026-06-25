import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	MAX_PENDING,
	OS_HANDOFF_PROMPT_CHANNEL,
	OsHandoffPromptDecision,
	OsHandoffPromptHost,
	PROMPT_TIMEOUT_MS,
	type PromptSender,
} from "./os-handoff-prompt";

function fakeSender(): PromptSender & { sends: Array<{ channel: string; payload: unknown }> } {
	const sends: Array<{ channel: string; payload: unknown }> = [];
	return {
		send: (channel, payload) => sends.push({ channel, payload }),
		sends,
	};
}

describe("OsHandoffPromptHost — without dashboard", () => {
	it("fails closed (Cancel) when no dashboard is set", async () => {
		const host = new OsHandoffPromptHost();
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const decision = await host.request("scheme:mailto", "mailto:a@example.com");
		expect(decision).toBe(OsHandoffPromptDecision.Cancel);
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});

	it("fails closed after `setDashboard(null)` (cleanup race)", async () => {
		const host = new OsHandoffPromptHost();
		host.setDashboard(fakeSender());
		host.setDashboard(null);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		expect(await host.request("scheme:https", "https://example.com")).toBe(
			OsHandoffPromptDecision.Cancel,
		);
		warn.mockRestore();
	});
});

describe("OsHandoffPromptHost — happy path", () => {
	it("posts the prompt IPC carrying signature + uri + a fresh requestId", async () => {
		const host = new OsHandoffPromptHost();
		const sender = fakeSender();
		host.setDashboard(sender);
		const promise = host.request("scheme:mailto", "mailto:a@example.com");
		expect(sender.sends).toHaveLength(1);
		const send = sender.sends[0];
		expect(send?.channel).toBe(OS_HANDOFF_PROMPT_CHANNEL);
		const payload = send?.payload as {
			requestId: string;
			signature: string;
			uri: string;
		};
		expect(payload.signature).toBe("scheme:mailto");
		expect(payload.uri).toBe("mailto:a@example.com");
		expect(payload.requestId).toMatch(/^osh_/);
		// Deliver an Allow reply — the promise resolves to Allow.
		host.handleReply({ requestId: payload.requestId, decision: OsHandoffPromptDecision.Allow });
		expect(await promise).toBe(OsHandoffPromptDecision.Allow);
	});

	it("propagates Deny and Cancel decisions verbatim", async () => {
		const host = new OsHandoffPromptHost();
		const sender = fakeSender();
		host.setDashboard(sender);
		const promise = host.request("ext:pdf", "/tmp/x.pdf");
		const payload = sender.sends[0]?.payload as { requestId: string };
		host.handleReply({ requestId: payload.requestId, decision: OsHandoffPromptDecision.Deny });
		expect(await promise).toBe(OsHandoffPromptDecision.Deny);

		const promise2 = host.request("scheme:tel", "tel:+1234567890");
		const payload2 = sender.sends[1]?.payload as { requestId: string };
		host.handleReply({
			requestId: payload2.requestId,
			decision: OsHandoffPromptDecision.Cancel,
		});
		expect(await promise2).toBe(OsHandoffPromptDecision.Cancel);
	});

	it("distinct signatures mint unique requestIds (no cross-resolution)", async () => {
		// Per-signature dedup collapses same-signature requests to one prompt
		// (covered separately); distinct signatures still mint independent
		// requests that resolve independently.
		const host = new OsHandoffPromptHost();
		const sender = fakeSender();
		host.setDashboard(sender);
		const p1 = host.request("scheme:https", "https://a.example");
		const p2 = host.request("scheme:mailto", "mailto:a@example.com");
		const id1 = (sender.sends[0]?.payload as { requestId: string }).requestId;
		const id2 = (sender.sends[1]?.payload as { requestId: string }).requestId;
		expect(id1).not.toBe(id2);
		host.handleReply({ requestId: id2, decision: OsHandoffPromptDecision.Allow });
		host.handleReply({ requestId: id1, decision: OsHandoffPromptDecision.Deny });
		expect(await p1).toBe(OsHandoffPromptDecision.Deny);
		expect(await p2).toBe(OsHandoffPromptDecision.Allow);
	});

	it("resolves all pending requests with Cancel when the dashboard goes away", async () => {
		const host = new OsHandoffPromptHost();
		const sender = fakeSender();
		host.setDashboard(sender);
		const p1 = host.request("scheme:mailto", "mailto:a@example.com");
		const p2 = host.request("ext:pdf", "/tmp/x.pdf");
		host.setDashboard(null);
		expect(await p1).toBe(OsHandoffPromptDecision.Cancel);
		expect(await p2).toBe(OsHandoffPromptDecision.Cancel);
	});

	it("ignores a reply for an unknown / duplicate requestId", async () => {
		const host = new OsHandoffPromptHost();
		const sender = fakeSender();
		host.setDashboard(sender);
		const promise = host.request("scheme:tel", "tel:+1");
		const requestId = (sender.sends[0]?.payload as { requestId: string }).requestId;
		// Spurious unknown id — silently dropped.
		host.handleReply({
			requestId: "osh_does-not-exist",
			decision: OsHandoffPromptDecision.Allow,
		});
		// Real id resolves.
		host.handleReply({ requestId, decision: OsHandoffPromptDecision.Allow });
		// Duplicate of the same id — already resolved, dropped silently.
		host.handleReply({ requestId, decision: OsHandoffPromptDecision.Deny });
		expect(await promise).toBe(OsHandoffPromptDecision.Allow);
	});
});

// OpenRes-1c slice 4 — dedup + timeout + cap hardening (CR-2). Pinned by
// OQ-227 (60 s timeout, 16 pending cap, newest-rejected on overflow).

describe("OsHandoffPromptHost — per-signature dedup", () => {
	it("a second request for an in-flight signature resolves to the same decision", async () => {
		const host = new OsHandoffPromptHost();
		const sender = fakeSender();
		host.setDashboard(sender);
		const p1 = host.request("scheme:https", "https://a.example");
		const p2 = host.request("scheme:https", "https://b.example");
		// Only ONE prompt is posted — the dashboard never sees a duplicate
		// modal for the same scheme.
		expect(sender.sends).toHaveLength(1);
		const requestId = (sender.sends[0]?.payload as { requestId: string }).requestId;
		host.handleReply({ requestId, decision: OsHandoffPromptDecision.Allow });
		expect(await p1).toBe(OsHandoffPromptDecision.Allow);
		expect(await p2).toBe(OsHandoffPromptDecision.Allow);
	});

	it("a second request after the first resolves mints a new prompt", async () => {
		const host = new OsHandoffPromptHost();
		const sender = fakeSender();
		host.setDashboard(sender);
		const p1 = host.request("scheme:https", "https://a.example");
		const id1 = (sender.sends[0]?.payload as { requestId: string }).requestId;
		host.handleReply({ requestId: id1, decision: OsHandoffPromptDecision.Allow });
		expect(await p1).toBe(OsHandoffPromptDecision.Allow);
		// Now that the in-flight entry resolved + cleared, the next request
		// for the same signature is a fresh prompt with a new id.
		const p2 = host.request("scheme:https", "https://b.example");
		expect(sender.sends).toHaveLength(2);
		const id2 = (sender.sends[1]?.payload as { requestId: string }).requestId;
		expect(id2).not.toBe(id1);
		host.handleReply({ requestId: id2, decision: OsHandoffPromptDecision.Deny });
		expect(await p2).toBe(OsHandoffPromptDecision.Deny);
	});
});

describe("OsHandoffPromptHost — timeout", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("an unanswered request resolves to Cancel after PROMPT_TIMEOUT_MS", async () => {
		const host = new OsHandoffPromptHost();
		const sender = fakeSender();
		host.setDashboard(sender);
		const promise = host.request("scheme:mailto", "mailto:a@b.com");
		await vi.advanceTimersByTimeAsync(PROMPT_TIMEOUT_MS);
		expect(await promise).toBe(OsHandoffPromptDecision.Cancel);
	});

	it("a reply before the timeout clears the timer (no double-resolution)", async () => {
		const host = new OsHandoffPromptHost();
		const sender = fakeSender();
		host.setDashboard(sender);
		const promise = host.request("scheme:mailto", "mailto:a@b.com");
		const requestId = (sender.sends[0]?.payload as { requestId: string }).requestId;
		host.handleReply({ requestId, decision: OsHandoffPromptDecision.Allow });
		// Even after time elapses past the timeout, the resolved promise
		// must not flip — clearTimeout already disarmed the Cancel.
		await vi.advanceTimersByTimeAsync(PROMPT_TIMEOUT_MS * 2);
		expect(await promise).toBe(OsHandoffPromptDecision.Allow);
	});
});

describe("OsHandoffPromptHost — pending cap", () => {
	it("rejects the newest request with Cancel when the queue is full", async () => {
		const host = new OsHandoffPromptHost();
		const sender = fakeSender();
		host.setDashboard(sender);
		const pending: Array<Promise<OsHandoffPromptDecision>> = [];
		for (let i = 0; i < MAX_PENDING; i++) {
			pending.push(host.request(`scheme:custom-${i}`, `custom-${i}:`));
		}
		expect(sender.sends).toHaveLength(MAX_PENDING);
		// The (MAX_PENDING+1)th request is rejected immediately with Cancel
		// — the in-flight modal the user is staring at survives. The
		// rejected request never reaches the dashboard, so the send list
		// stays at MAX_PENDING.
		const overflow = host.request("scheme:overflow", "overflow:");
		expect(await overflow).toBe(OsHandoffPromptDecision.Cancel);
		expect(sender.sends).toHaveLength(MAX_PENDING);
		// The original 16 remain in flight (drain them so they don't leak).
		host.setDashboard(null);
		for (const p of pending) expect(await p).toBe(OsHandoffPromptDecision.Cancel);
	});

	it("doesn't evict resolved entries — replying frees a slot", async () => {
		const host = new OsHandoffPromptHost();
		const sender = fakeSender();
		host.setDashboard(sender);
		const pending: Array<Promise<OsHandoffPromptDecision>> = [];
		for (let i = 0; i < MAX_PENDING; i++) {
			pending.push(host.request(`scheme:slot-${i}`, `slot-${i}:`));
		}
		// Resolve the first slot's prompt — that signature's pending entry
		// clears, freeing a slot for a new (distinct-signature) request.
		const firstId = (sender.sends[0]?.payload as { requestId: string }).requestId;
		host.handleReply({ requestId: firstId, decision: OsHandoffPromptDecision.Allow });
		expect(await pending[0]).toBe(OsHandoffPromptDecision.Allow);
		// A new request now succeeds (would have been rejected before).
		const next = host.request("scheme:fresh", "fresh:");
		expect(sender.sends).toHaveLength(MAX_PENDING + 1);
		const nextId = (sender.sends.at(-1)?.payload as { requestId: string }).requestId;
		host.handleReply({ requestId: nextId, decision: OsHandoffPromptDecision.Allow });
		expect(await next).toBe(OsHandoffPromptDecision.Allow);
		host.setDashboard(null);
		for (let i = 1; i < MAX_PENDING; i++) {
			expect(await pending[i]).toBe(OsHandoffPromptDecision.Cancel);
		}
	});
});
