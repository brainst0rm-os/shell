import { describe, expect, it } from "vitest";
import { type Entity, FILE_TYPE, FOLDER_TYPE } from "../types/entity";
import { dragItemsForEntry } from "./drag-items";
import type { SelectionState } from "./selection";

function entry(id: string, props: Record<string, unknown> = {}, type: string = FILE_TYPE): Entity {
	return {
		id,
		type,
		properties: { name: id.toUpperCase(), ...props },
		createdAt: 0,
		updatedAt: 0,
		deletedAt: null,
	};
}

function selection(ids: string[], anchorId: string | null = ids[0] ?? null): SelectionState {
	return { anchorId, selected: new Set(ids) };
}

describe("dragItemsForEntry", () => {
	const entries = [entry("a"), entry("b", { icon: "📌" }), entry("c", {}, FOLDER_TYPE)];

	it("carries only the dragged entry when it is not part of the selection", () => {
		const items = dragItemsForEntry(entry("a"), selection(["b", "c"]), entries);
		expect(items.map((i) => i.entityId)).toEqual(["a"]);
	});

	it("carries the whole selection, in on-screen order, when the dragged entry is selected", () => {
		const items = dragItemsForEntry(entry("c"), selection(["c", "a"]), entries);
		expect(items.map((i) => i.entityId)).toEqual(["a", "c"]);
	});

	it("carries just the entry for a single-selection drag", () => {
		const items = dragItemsForEntry(entry("b"), selection(["b"]), entries);
		expect(items.map((i) => i.entityId)).toEqual(["b"]);
	});

	it("captures the label and entity type as a reference-only item", () => {
		const folder = entry("c", {}, FOLDER_TYPE);
		const items = dragItemsForEntry(folder, selection(["c"]), [folder]);
		expect(items[0]).toMatchObject({ entityId: "c", entityType: FOLDER_TYPE, label: "C" });
	});

	it("includes a string icon as iconRef and omits a non-string one", () => {
		const withIcon = entry("b", { icon: "📌" });
		const items = dragItemsForEntry(withIcon, selection(["b"]), [withIcon]);
		expect(items[0]?.iconRef).toBe("📌");
		const plain = entry("a");
		const noIcon = dragItemsForEntry(plain, selection(["a"]), [plain]);
		expect(noIcon[0]?.iconRef).toBeUndefined();
	});
});
