import { describe, expect, it } from "vitest";
import { type PersonCompanyRow, companyIdForName, planCompanyMigration } from "./company-migration";

function person(id: string, company: unknown): PersonCompanyRow {
	return { id, company, updatedAt: 1 };
}

describe("companyIdForName", () => {
	it("slugifies the name deterministically", () => {
		expect(companyIdForName("Brainstorm")).toBe("company_brainstorm");
		expect(companyIdForName("Acme Press")).toBe("company_acme_press");
		expect(companyIdForName("  Foo & Bar, Inc. ")).toBe("company_foo_bar_inc");
	});

	it("falls back for an all-punctuation name", () => {
		expect(companyIdForName("!!!")).toBe("company_unnamed");
	});
});

describe("planCompanyMigration", () => {
	it("creates one Company per distinct name and points each person at it", () => {
		const plan = planCompanyMigration(
			[person("p_ada", "Brainstorm"), person("p_lin", "Brainstorm"), person("p_mara", "Acme Press")],
			new Set(),
		);
		expect(plan.companies).toEqual([
			{ id: "company_brainstorm", name: "Brainstorm" },
			{ id: "company_acme_press", name: "Acme Press" },
		]);
		expect(plan.updates).toEqual([
			{ personId: "p_ada", companyId: "company_brainstorm" },
			{ personId: "p_lin", companyId: "company_brainstorm" },
			{ personId: "p_mara", companyId: "company_acme_press" },
		]);
	});

	it("skips persons without a string company", () => {
		const plan = planCompanyMigration(
			[person("p1", null), person("p2", ""), person("p3", 42), person("p4", "   ")],
			new Set(),
		);
		expect(plan.companies).toEqual([]);
		expect(plan.updates).toEqual([]);
	});

	it("is idempotent: a value already pointing at a known company is left alone", () => {
		const plan = planCompanyMigration(
			[person("p_ada", "company_brainstorm")],
			new Set(["company_brainstorm"]),
		);
		expect(plan.companies).toEqual([]);
		expect(plan.updates).toEqual([]);
	});

	it("does not re-create a company that already exists, but still re-points the person", () => {
		const plan = planCompanyMigration(
			[person("p_new", "Brainstorm")],
			new Set(["company_brainstorm"]),
		);
		expect(plan.companies).toEqual([]);
		expect(plan.updates).toEqual([{ personId: "p_new", companyId: "company_brainstorm" }]);
	});
});
