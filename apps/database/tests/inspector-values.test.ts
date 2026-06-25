/**
 * @vitest-environment jsdom
 *
 * Proves object-typed property values never render as "[object Object]"
 * (the user-reported bug): a rich-text body flattens to a text preview,
 * an opaque object map becomes the empty value, arrays join.
 */

import { describe, expect, it } from "vitest";
import type { EntityRow } from "../src/logic/in-memory-entities";
import { paintPropertyValue, renderCell } from "../src/render/cells";

const entity = (properties: Record<string, unknown>): EntityRow => ({
	id: "e1",
	type: "io.brainstorm.notes/Note/v1",
	properties,
	createdAt: 1,
	updatedAt: 1,
	deletedAt: null,
});

describe("renderCell — object values are never [object Object]", () => {
	it("rich-text body → flattened plain-text preview", () => {
		const body = {
			root: {
				children: [{ type: "paragraph", children: [{ text: "Hello " }, { text: "world" }] }],
			},
		};
		const out = renderCell(entity({ body }), "body");
		expect(out.text).not.toContain("[object Object]");
		expect(out.text).toContain("Hello");
		expect(out.text).toContain("world");
	});

	it("opaque object map (e.g. empty values) → not [object Object]", () => {
		const out = renderCell(entity({ values: {} }), "values");
		expect(out.text).not.toContain("[object Object]");
	});

	it("array value → joined, not [object Object]", () => {
		const out = renderCell(entity({ tags: ["a", "b", "c"] }), "tags");
		expect(out.text).not.toContain("[object Object]");
		expect(out.text).toMatch(/a.*b.*c/);
	});

	it("scalars are unaffected", () => {
		expect(renderCell(entity({ name: "Plain" }), "name").text).toBe("Plain");
	});
});

describe("paintPropertyValue — array-of-objects column (e.g. whiteboard nodes)", () => {
	it("renders a count summary, never a pile of [object Object]", () => {
		const el = paintPropertyValue(entity({ nodes: [{ x: 1 }, { x: 2 }, { x: 3 }] }), "nodes", "cell");
		expect(el).not.toBeNull();
		expect(el?.textContent ?? "").not.toContain("[object Object]");
		expect(el?.textContent).toBe("3 items");
	});

	it("a scalar array still renders as tag pills", () => {
		const el = paintPropertyValue(entity({ tags: ["red", "green"] }), "tags", "cell");
		expect(el?.textContent ?? "").not.toContain("[object Object]");
		expect(el?.querySelectorAll(".dbv-tag").length).toBe(2);
	});
});
