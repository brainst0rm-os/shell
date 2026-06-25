import { describe, expect, it } from "vitest";
import type { StoredNote } from "../store/note";
import { disambiguateLabels, listLabel } from "./notes-list";

function note(partial: Partial<StoredNote>): StoredNote {
	return {
		id: "n1",
		title: "",
		icon: null,
		cover: null,
		body: "",
		values: {} as StoredNote["values"],
		createdAt: 0,
		updatedAt: 0,
		...partial,
	} as StoredNote;
}

describe("listLabel — untitled disambiguation (F-039)", () => {
	it("uses the explicit title when present", () => {
		expect(listLabel(note({ title: "Northbound — research thesis" }))).toBe(
			"Northbound — research thesis",
		);
	});

	it("falls back to a body snippet for an untitled note that has body text", () => {
		expect(listLabel(note({ body: "A quick captured thought" }))).toBe("A quick captured thought");
	});

	it("disambiguates two blank untitled notes by their last-edited time", () => {
		const a = listLabel(note({ updatedAt: new Date(2026, 0, 1, 9, 5).getTime() }));
		const b = listLabel(note({ updatedAt: new Date(2026, 0, 1, 14, 32).getTime() }));
		// Both read "Untitled …" but are NOT the same bare label.
		expect(a).toMatch(/^Untitled · /);
		expect(b).toMatch(/^Untitled · /);
		expect(a).not.toBe(b);
	});
});

describe("disambiguateLabels — same-minute untitled collisions (F-039)", () => {
	it("numbers blank untitled notes created in the same minute", () => {
		// Three blank notes, same minute → same time suffix without numbering.
		const ts = new Date(2026, 0, 1, 23, 31).getTime();
		const notes = [
			note({ id: "n1", updatedAt: ts }),
			note({ id: "n2", updatedAt: ts }),
			note({ id: "n3", updatedAt: ts }),
		];
		const labels = disambiguateLabels(notes);
		const values = ["n1", "n2", "n3"].map((id) => labels.get(id));
		expect(new Set(values).size).toBe(3); // all distinct
		expect(values[0]).toBe("Untitled · 11:31 PM");
		expect(values[1]).toBe("Untitled · 11:31 PM (2)");
		expect(values[2]).toBe("Untitled · 11:31 PM (3)");
	});

	it("leaves a titled note and a distinct-time blank note un-numbered", () => {
		const labels = disambiguateLabels([
			note({ id: "t", title: "Pricing model" }),
			note({ id: "u1", updatedAt: new Date(2026, 0, 1, 9, 5).getTime() }),
			note({ id: "u2", updatedAt: new Date(2026, 0, 1, 14, 32).getTime() }),
		]);
		expect(labels.get("t")).toBe("Pricing model");
		expect(labels.get("u1")).toBe("Untitled · 9:05 AM");
		expect(labels.get("u2")).toBe("Untitled · 2:32 PM");
	});

	it("does not number notes a user deliberately gave the same title", () => {
		const labels = disambiguateLabels([
			note({ id: "a", title: "Meeting" }),
			note({ id: "b", title: "Meeting" }),
		]);
		expect(labels.get("a")).toBe("Meeting");
		expect(labels.get("b")).toBe("Meeting");
	});
});
