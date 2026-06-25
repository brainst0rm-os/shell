import { describe, expect, it } from "vitest";
import { decideOpenAction } from "../src/logic/open-action";

describe("decideOpenAction", () => {
	it("drives the gallery when a context is supplied (id may be absent)", () => {
		expect(decideOpenAction({ context: { kind: "folder" } })).toEqual({
			kind: "context",
			entityId: undefined,
		});
		expect(decideOpenAction({ entityId: "ent_1", context: { kind: "folder" } })).toEqual({
			kind: "context",
			entityId: "ent_1",
		});
	});

	it("drives the gallery when a non-empty siblings list is supplied", () => {
		expect(decideOpenAction({ entityId: "ent_2", siblings: [{ id: "a" }] })).toEqual({
			kind: "context",
			entityId: "ent_2",
		});
	});

	it("focuses within the current set when only an entity id is given", () => {
		expect(decideOpenAction({ entityId: "ent_9" })).toEqual({ kind: "focus", entityId: "ent_9" });
		expect(decideOpenAction({ entityId: "ent_9", siblings: [] })).toEqual({
			kind: "focus",
			entityId: "ent_9",
		});
	});

	it("is a no-op for a payload with neither a usable id nor a context", () => {
		expect(decideOpenAction({})).toEqual({ kind: "none" });
		expect(decideOpenAction({ entityId: "" })).toEqual({ kind: "none" });
		expect(decideOpenAction({ entityId: 42 })).toEqual({ kind: "none" });
		expect(decideOpenAction({ siblings: [] })).toEqual({ kind: "none" });
		expect(decideOpenAction({ context: null })).toEqual({ kind: "none" });
	});
});
