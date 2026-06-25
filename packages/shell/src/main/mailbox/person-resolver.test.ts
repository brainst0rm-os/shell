import { describe, expect, it } from "vitest";
import { buildPersonIndex, resolveParticipants, resolvePersonRef } from "./person-resolver";

const entities = [
	{
		id: "person-dana",
		type: "brainstorm/Person/v1",
		properties: { name: "Dana Lee", email: ["dana@example.com", "Dana@Work.com"] },
	},
	{
		id: "person-sam",
		type: "brainstorm/Person/v1",
		properties: { name: "Sam", email: ["sam@example.com"] },
	},
	{ id: "note-1", type: "brainstorm/Note/v1", properties: { email: ["noise@example.com"] } },
	{ id: "person-noemail", type: "brainstorm/Person/v1", properties: { name: "No Email" } },
];

describe("buildPersonIndex", () => {
	it("indexes every Person email, case-insensitively, ignoring non-persons", () => {
		const index = buildPersonIndex(entities);
		expect(index.get("dana@example.com")).toBe("person-dana");
		expect(index.get("dana@work.com")).toBe("person-dana");
		expect(index.get("sam@example.com")).toBe("person-sam");
		expect(index.has("noise@example.com")).toBe(false);
	});
});

describe("resolvePersonRef", () => {
	it("matches normalised addresses and misses unknowns", () => {
		const index = buildPersonIndex(entities);
		expect(resolvePersonRef(index, "  DANA@example.com ")).toBe("person-dana");
		expect(resolvePersonRef(index, "stranger@example.com")).toBeUndefined();
	});
});

describe("resolveParticipants", () => {
	it("stamps personRef on matches and leaves unmatched untouched (no auto-create)", () => {
		const index = buildPersonIndex(entities);
		const result = resolveParticipants(index, [
			{ address: "dana@example.com", name: "Dana Lee" },
			{ address: "stranger@example.com" },
		]);
		expect(result[0]).toEqual({
			address: "dana@example.com",
			name: "Dana Lee",
			personRef: "person-dana",
		});
		expect(result[1]).toEqual({ address: "stranger@example.com" });
	});

	it("does not mutate the input array", () => {
		const index = buildPersonIndex(entities);
		const input = [{ address: "dana@example.com" }];
		resolveParticipants(index, input);
		expect(input[0]).toEqual({ address: "dana@example.com" });
	});
});
