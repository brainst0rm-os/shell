import { describe, expect, it } from "vitest";
import { COMPANY_TYPE, PERSON_TYPE, type VaultEntityLike } from "../types/person";
import {
	buildCompanyNameIndex,
	composeDraftValid,
	emptyComposeDraft,
	planCompose,
} from "./compose";

describe("composeDraftValid", () => {
	it("rejects an empty draft", () => {
		expect(composeDraftValid(emptyComposeDraft())).toBe(false);
	});

	it("rejects a whitespace-only name", () => {
		expect(composeDraftValid({ ...emptyComposeDraft(), name: "   " })).toBe(false);
	});

	it("accepts a draft with a real name", () => {
		expect(composeDraftValid({ ...emptyComposeDraft(), name: "Ada" })).toBe(true);
	});
});

describe("planCompose", () => {
	it("returns null for an invalid draft", () => {
		expect(planCompose({ ...emptyComposeDraft(), email: "a@b.c" })).toBeNull();
	});

	it("trims the name and omits blank optional fields", () => {
		const plan = planCompose({ name: "  Ada Okafor  ", company: " ", email: "", phone: "" });
		expect(plan).toEqual({ props: { name: "Ada Okafor" }, companyName: null });
	});

	it("wraps email and phone as single-element arrays", () => {
		const plan = planCompose({
			name: "Ada",
			company: "",
			email: " ada@acme.example ",
			phone: " +1 555 0142 ",
		});
		expect(plan?.props).toEqual({
			name: "Ada",
			email: ["ada@acme.example"],
			phone: ["+1 555 0142"],
		});
	});

	it("carries the trimmed company name for the caller to resolve", () => {
		const plan = planCompose({ name: "Ada", company: "  Acme Corp ", email: "", phone: "" });
		expect(plan?.companyName).toBe("Acme Corp");
		expect(plan?.props).not.toHaveProperty("company");
	});
});

describe("buildCompanyNameIndex", () => {
	const entities: VaultEntityLike[] = [
		{ id: "co1", type: COMPANY_TYPE, properties: { name: "Acme Corp" } },
		{ id: "co2", type: COMPANY_TYPE, properties: { name: "  " } },
		{ id: "p1", type: PERSON_TYPE, properties: { name: "Acme Corp" } },
		{ id: "co3", type: COMPANY_TYPE, properties: { name: "acme corp" } },
	];

	it("indexes companies case-insensitively, ignoring people and unnamed rows", () => {
		const index = buildCompanyNameIndex(entities);
		expect(index.get("acme corp")).toBe("co1");
		expect(index.size).toBe(1);
	});
});
