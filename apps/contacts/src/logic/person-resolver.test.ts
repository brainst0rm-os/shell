import { describe, expect, it } from "vitest";
import { COMPANY_TYPE, PERSON_TYPE, type VaultEntityLike } from "../types/person";
import {
	buildPersonEmailIndex,
	resolvePersonIdByEmail,
	resolvePersonIdByEmails,
} from "./person-resolver";

function person(id: string, props: Record<string, unknown>): VaultEntityLike {
	return { id, type: PERSON_TYPE, properties: props };
}

describe("buildPersonEmailIndex", () => {
	it("maps every listed email to its person, case-insensitively", () => {
		const index = buildPersonEmailIndex([
			person("p1", { name: "Ada", email: ["Ada@Example.com", "ada.work@corp.io"] }),
		]);
		expect(index.get("ada@example.com")).toBe("p1");
		expect(index.get("ada.work@corp.io")).toBe("p1");
		expect(index.size).toBe(2);
	});

	it("trims surrounding whitespace before indexing", () => {
		const index = buildPersonEmailIndex([
			person("p1", { name: "Ada", email: ["  Ada@Example.com  "] }),
		]);
		expect(index.get("ada@example.com")).toBe("p1");
	});

	it("ignores non-Person entities", () => {
		const index = buildPersonEmailIndex([
			{ id: "c1", type: COMPANY_TYPE, properties: { name: "Corp", email: ["hi@corp.io"] } },
		]);
		expect(index.size).toBe(0);
	});

	it("tolerates the bare-string and envelope value shapes", () => {
		const index = buildPersonEmailIndex([
			person("p1", { name: "Ada", email: "ada@example.com" }),
			person("p2", { name: "Bea", email: [{ value: "bea@example.com" }] }),
		]);
		expect(index.get("ada@example.com")).toBe("p1");
		expect(index.get("bea@example.com")).toBe("p2");
	});

	it("drops blank email values", () => {
		const index = buildPersonEmailIndex([person("p1", { name: "Ada", email: ["", "   "] })]);
		expect(index.size).toBe(0);
	});

	it("keeps the first writer on a duplicate address (snapshot order)", () => {
		const index = buildPersonEmailIndex([
			person("p1", { name: "Ada", email: ["shared@example.com"] }),
			person("p2", { name: "Ada Dup", email: ["shared@example.com"] }),
		]);
		expect(index.get("shared@example.com")).toBe("p1");
	});
});

describe("resolvePersonIdByEmail", () => {
	const index = buildPersonEmailIndex([person("p1", { name: "Ada", email: ["ada@example.com"] })]);

	it("resolves a known address (case/space-insensitive)", () => {
		expect(resolvePersonIdByEmail(index, "  ADA@Example.COM ")).toBe("p1");
	});

	it("returns null on a miss — never auto-creates", () => {
		expect(resolvePersonIdByEmail(index, "stranger@example.com")).toBeNull();
	});

	it("returns null for a blank address", () => {
		expect(resolvePersonIdByEmail(index, "   ")).toBeNull();
	});
});

describe("resolvePersonIdByEmails", () => {
	const index = buildPersonEmailIndex([
		person("p1", { name: "Ada", email: ["ada@example.com"] }),
		person("p2", { name: "Bea", email: ["bea@example.com"] }),
	]);

	it("matches any address, first-match wins on input order", () => {
		expect(resolvePersonIdByEmails(index, ["nope@x.io", "bea@example.com", "ada@example.com"])).toBe(
			"p2",
		);
	});

	it("returns null when none match", () => {
		expect(resolvePersonIdByEmails(index, ["nope@x.io", "missing@y.io"])).toBeNull();
	});

	it("returns null for an empty address list", () => {
		expect(resolvePersonIdByEmails(index, [])).toBeNull();
	});
});
