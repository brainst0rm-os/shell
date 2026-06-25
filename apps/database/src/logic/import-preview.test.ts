import { describe, expect, it } from "vitest";
import type { PersonDraft } from "./contact-import";
import { ImportAction, type ImportPlanRow, commandsFor, planImport } from "./contact-import-plan";
import {
	actionVerb,
	buildPreviewRow,
	buildPreviewRows,
	formatPreviewValue,
	isEditableValue,
	nextAction,
	parsePreviewValue,
} from "./import-preview";

const id = (k: string): string => k; // labelOf passthrough for assertions

function draft(over: Partial<PersonDraft> & { name: string }): PersonDraft {
	return { ...over };
}

describe("formatPreviewValue", () => {
	it("renders each value shape as a display string", () => {
		expect(formatPreviewValue("Ada")).toBe("Ada");
		expect(formatPreviewValue(42)).toBe("42");
		expect(formatPreviewValue(true)).toBe("yes");
		expect(formatPreviewValue(false)).toBe("no");
		expect(formatPreviewValue(["a@x.com", "b@x.com"])).toBe("a@x.com; b@x.com");
		expect(formatPreviewValue(null)).toBe("");
		expect(formatPreviewValue(undefined)).toBe("");
		expect(formatPreviewValue(Number.NaN)).toBe("");
	});

	it("drops blank list entries and non-strings from a list", () => {
		expect(formatPreviewValue(["a", "", "  "])).toBe("a");
	});

	it("JSON-stringifies a structured value rather than [object Object]", () => {
		expect(formatPreviewValue({ at: 1 })).toBe('{"at":1}');
	});
});

describe("isEditableValue", () => {
	it("strings and string lists are editable; numbers/booleans/objects are not", () => {
		expect(isEditableValue("x")).toBe(true);
		expect(isEditableValue(["x", "y"])).toBe(true);
		expect(isEditableValue([])).toBe(true);
		expect(isEditableValue(42)).toBe(false);
		expect(isEditableValue(true)).toBe(false);
		expect(isEditableValue({ at: 1 })).toBe(false);
	});
});

describe("parsePreviewValue", () => {
	it("trims a scalar string", () => {
		expect(parsePreviewValue("  Ada  ", "x")).toBe("Ada");
	});

	it("splits a list on commas/semicolons, trimming and dropping blanks", () => {
		expect(parsePreviewValue("a@x.com; b@x.com , ", [])).toEqual(["a@x.com", "b@x.com"]);
	});

	it("a blank edit clears the field (empty string / empty list)", () => {
		expect(parsePreviewValue("", "x")).toBe("");
		expect(parsePreviewValue("  ", [])).toEqual([]);
	});
});

describe("nextAction", () => {
	it("an unmatched row flips Create⇄Skip", () => {
		expect(nextAction(ImportAction.Create, false)).toBe(ImportAction.Skip);
		expect(nextAction(ImportAction.Skip, false)).toBe(ImportAction.Create);
	});

	it("a matched row rotates Merge→Create→Skip→Merge", () => {
		expect(nextAction(ImportAction.Merge, true)).toBe(ImportAction.Create);
		expect(nextAction(ImportAction.Create, true)).toBe(ImportAction.Skip);
		expect(nextAction(ImportAction.Skip, true)).toBe(ImportAction.Merge);
	});
});

describe("actionVerb", () => {
	it("maps each action to its badge label", () => {
		expect(actionVerb(ImportAction.Create)).toBe("New");
		expect(actionVerb(ImportAction.Merge)).toBe("Merge");
		expect(actionVerb(ImportAction.Skip)).toBe("Skip");
	});
});

describe("buildPreviewRow", () => {
	it("a create row exposes the draft's editable property bag, no diff", () => {
		const plan = planImport([draft({ name: "Ada", email: ["ada@x.com"], company: "BU" })], []);
		const row = buildPreviewRow(plan[0] as ImportPlanRow, 0, new Map(), id);
		expect(row.title).toBe("Ada");
		expect(row.defaultAction).toBe(ImportAction.Create);
		expect(row.hasMatch).toBe(false);
		expect(row.diff).toEqual([]);
		const name = row.fields.find((f) => f.key === "name");
		const email = row.fields.find((f) => f.key === "email");
		expect(name).toMatchObject({ value: "Ada", editable: true, isList: false });
		expect(email).toMatchObject({ value: "ada@x.com", editable: true, isList: true });
	});

	it("a merge row diffs the existing bag against the merged result", () => {
		const existing = [{ id: "p1", properties: { name: "Ada", email: ["ada@old.com"] } }];
		const plan = planImport([draft({ name: "Ada", email: ["ada@new.com"] })], existing);
		expect(plan[0]?.action).toBe(ImportAction.Merge);
		const byId = new Map([["p1", existing[0]?.properties as Record<string, unknown>]]);
		const row = buildPreviewRow(plan[0] as ImportPlanRow, 0, byId, id);
		expect(row.hasMatch).toBe(true);
		expect(row.matchId).toBe("p1");
		const emailDiff = row.diff.find((d) => d.key === "email");
		expect(emailDiff).toMatchObject({
			before: "ada@old.com",
			after: "ada@old.com; ada@new.com",
			changed: true,
		});
		const nameDiff = row.diff.find((d) => d.key === "name");
		expect(nameDiff?.changed).toBe(false);
	});

	it("falls back to (untitled) when the name is blank", () => {
		const plan = planImport([draft({ name: "" })], []);
		const row = buildPreviewRow(plan[0] as ImportPlanRow, 0, new Map(), id);
		expect(row.title).toBe("(untitled)");
	});
});

describe("buildPreviewRows + commandsFor integration", () => {
	it("per-row edits round-trip into the committed command bag", () => {
		const plan = planImport([draft({ name: "Ada", company: "Old" })], []);
		const rows = buildPreviewRows(plan, [], id);
		expect(rows).toHaveLength(1);

		// User edits the company field on row 0; the field is editable.
		const companyField = rows[0]?.fields.find((f) => f.key === "company");
		expect(companyField?.editable).toBe(true);
		const edited = parsePreviewValue("New Co", companyField?.isList ? [] : "");

		const commands = commandsFor(plan, {}, { 0: { company: edited } });
		expect(commands).toEqual([{ op: "create", properties: { name: "Ada", company: "New Co" } }]);
	});

	it("an action override to Skip drops the row's command", () => {
		const plan = planImport([draft({ name: "Ada" }), draft({ name: "Grace" })], []);
		const commands = commandsFor(plan, { 0: ImportAction.Skip });
		expect(commands).toEqual([{ op: "create", properties: { name: "Grace" } }]);
	});
});
