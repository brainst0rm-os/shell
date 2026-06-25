import { describe, expect, it } from "vitest";
import { makeEnvelope } from "../../ipc/envelope";
import { handleStorageEnvelope } from "./index";

function mk(over: Partial<Parameters<typeof makeEnvelope>[0]> = {}) {
	return makeEnvelope({
		msg: "m1",
		app: "io.example.app",
		service: "storage",
		method: "ping",
		args: [],
		caps: [],
		...over,
	});
}

describe("storage worker", () => {
	it("responds to ping with a pong and a timestamp", async () => {
		const reply = await handleStorageEnvelope(mk({ args: ["hi"] }));
		expect(reply.ok).toBe(true);
		if (!reply.ok) throw new Error("expected ok reply");
		const value = reply.value as { pong: unknown; at: unknown };
		expect(value.pong).toBe("hi");
		expect(typeof value.at).toBe("number");
	});

	it("returns Unavailable for unknown methods", async () => {
		const reply = await handleStorageEnvelope(mk({ method: "doesNotExist" }));
		expect(reply.ok).toBe(false);
		expect(reply.ok === false && reply.error.kind).toBe("Unavailable");
	});

	it("returns Invalid for envelopes routed to the wrong service", async () => {
		const reply = await handleStorageEnvelope(mk({ service: "entities" }));
		expect(reply.ok).toBe(false);
		expect(reply.ok === false && reply.error.kind).toBe("Invalid");
	});

	it("returns Invalid for malformed envelopes", async () => {
		const reply = await handleStorageEnvelope({ shape: "wrong" });
		expect(reply.ok).toBe(false);
		expect(reply.ok === false && reply.error.kind).toBe("Invalid");
	});

	it("preserves the msg id across handling", async () => {
		const reply = await handleStorageEnvelope(mk({ msg: "specific" }));
		expect(reply.msg).toBe("specific");
	});
});
