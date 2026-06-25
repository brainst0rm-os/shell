import { describe, expect, it } from "vitest";
import { dragItemsForRow } from "./drag-items";
import type { EntityRow } from "./in-memory-entities";

function row(id: string, props: Record<string, unknown> = {}): EntityRow {
	return {
		id,
		type: "io.brainstorm.note/Note/v1",
		properties: { name: id.toUpperCase(), ...props },
		createdAt: 0,
		updatedAt: 0,
		deletedAt: null,
	};
}

describe("dragItemsForRow", () => {
	const rows = [row("a"), row("b", { icon: "📌" }), row("c")];

	it("carries only the dragged row when it is not part of the selection", () => {
		const items = dragItemsForRow(row("a"), new Set(["b", "c"]), rows);
		expect(items.map((i) => i.entityId)).toEqual(["a"]);
	});

	it("carries the whole selection, in row order, when the dragged row is selected", () => {
		const items = dragItemsForRow(row("c"), new Set(["c", "a"]), rows);
		expect(items.map((i) => i.entityId)).toEqual(["a", "c"]);
	});

	it("carries just the row for a single-selection drag", () => {
		const items = dragItemsForRow(row("b"), new Set(["b"]), rows);
		expect(items.map((i) => i.entityId)).toEqual(["b"]);
	});

	it("includes a string icon as iconRef and omits a non-string one", () => {
		const items = dragItemsForRow(row("b", { icon: "📌" }), new Set(["b"]), [
			row("b", { icon: "📌" }),
		]);
		expect(items[0]?.iconRef).toBe("📌");
		const noIcon = dragItemsForRow(row("a"), new Set(["a"]), [row("a")]);
		expect(noIcon[0]?.iconRef).toBeUndefined();
	});
});
