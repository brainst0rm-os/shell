import { describe, expect, it } from "vitest";
import { inboxChannelFor, isInboxChannel } from "./inbox-channel";

describe("inboxChannelFor", () => {
	it("is deterministic + prefixed, so owner and recipient derive the same channel", () => {
		const pub = "QjY0UHViS2V5QmFzZTY0";
		expect(inboxChannelFor(pub)).toBe(`inbox:${pub}`);
		expect(inboxChannelFor(pub)).toBe(inboxChannelFor(pub));
	});

	it("distinguishes identities", () => {
		expect(inboxChannelFor("alice")).not.toBe(inboxChannelFor("bob"));
	});

	it("never collides with an entity-id channel (entities don't start with `inbox:`)", () => {
		expect(isInboxChannel(inboxChannelFor("alice"))).toBe(true);
		expect(isInboxChannel("note:n_123")).toBe(false);
		expect(isInboxChannel("io.brainstorm.notes/Note/v1")).toBe(false);
	});
});
