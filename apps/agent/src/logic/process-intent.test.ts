import { describe, expect, it } from "vitest";
import { AgentProcessKind, seedFromProcessIntent } from "./process-intent";

describe("seedFromProcessIntent (doc 63 / AS-3 — Agent as contributor)", () => {
	it("returns null for a non-process verb", () => {
		expect(seedFromProcessIntent("open", { entityId: "ent_1" })).toBeNull();
		expect(seedFromProcessIntent("share", {})).toBeNull();
	});

	it("builds a summarize prompt referencing the target", () => {
		const seed = seedFromProcessIntent("process", {
			entityId: "ent_1",
			kind: AgentProcessKind.Summarize,
		});
		expect(seed?.entityId).toBe("ent_1");
		expect(seed?.instruction).toContain("Summarize");
		expect(seed?.instruction).toContain("ent_1");
	});

	it("builds an ask prompt for kind=ask", () => {
		const seed = seedFromProcessIntent("process", { entityId: "ent_2", kind: AgentProcessKind.Ask });
		expect(seed?.instruction.toLowerCase()).toContain("ask");
		expect(seed?.instruction).toContain("ent_2");
	});

	it("uses an explicit prompt verbatim when the dispatcher supplied one", () => {
		const seed = seedFromProcessIntent("process", {
			entityId: "ent_3",
			kind: AgentProcessKind.Summarize,
			prompt: "Translate this to French.",
		});
		expect(seed?.instruction).toBe("Translate this to French.");
	});

	it("falls back to a generic prompt for an unknown kind", () => {
		const seed = seedFromProcessIntent("process", { entityId: "ent_4", kind: "frobnicate" });
		expect(seed?.instruction).toContain("ent_4");
		expect(seed?.instruction.length).toBeGreaterThan(0);
	});

	it("works without a target entity id", () => {
		const seed = seedFromProcessIntent("process", { kind: AgentProcessKind.Summarize });
		expect(seed?.entityId).toBeUndefined();
		expect(seed?.instruction).toContain("Summarize");
	});
});
