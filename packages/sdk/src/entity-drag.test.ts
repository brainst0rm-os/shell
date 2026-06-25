import { describe, expect, it } from "vitest";
import {
	ENTITY_DRAG_MIME,
	type EntityDragPayload,
	MAX_DRAG_ITEMS,
	hardenObjectDragItem,
	hardenObjectDragItems,
	objectDragItemTypes,
	parseEntityDragPayload,
	parseObjectDragPayload,
	readObjectDragData,
	serializeEntityDragPayload,
	serializeObjectDragPayload,
	setObjectDragData,
} from "./entity-drag";

const BASE: EntityDragPayload = {
	entityId: "note-1",
	entityType: "io.brainstorm.notes/Note/v1",
	label: "My note",
};

describe("entity-drag payload", () => {
	it("round-trips a well-formed payload", () => {
		const wire = serializeEntityDragPayload({ ...BASE, iconRef: "📓" });
		expect(parseEntityDragPayload(wire)).toEqual({ ...BASE, iconRef: "📓" });
	});

	it("omits an empty iconRef rather than emitting a blank key", () => {
		const wire = serializeEntityDragPayload(BASE);
		const parsed = parseEntityDragPayload(wire);
		expect(parsed).not.toBeNull();
		expect("iconRef" in (parsed as object)).toBe(false);
	});

	it("returns null for a non-string / empty input", () => {
		expect(parseEntityDragPayload(null)).toBeNull();
		expect(parseEntityDragPayload(undefined)).toBeNull();
		expect(parseEntityDragPayload("")).toBeNull();
	});

	it("returns null for malformed JSON", () => {
		expect(parseEntityDragPayload("{not json")).toBeNull();
	});

	it("returns null when entityId is missing or blank", () => {
		expect(parseEntityDragPayload(JSON.stringify({ entityType: "x", label: "y" }))).toBeNull();
		expect(parseEntityDragPayload(JSON.stringify({ entityId: "", label: "y" }))).toBeNull();
	});

	it("strips bidi-override / zero-width control codes from every field", () => {
		const hostile = serializeEntityDragPayload({
			entityId: "note‮-1",
			entityType: "Type​",
			label: "Label⁦evil",
		});
		const parsed = parseEntityDragPayload(hostile);
		expect(parsed?.entityId).toBe("note-1");
		expect(parsed?.entityType).toBe("Type");
		expect(parsed?.label).toBe("Labelevil");
	});

	it("clamps an over-long field to 1024 chars", () => {
		const parsed = parseEntityDragPayload(JSON.stringify({ entityId: "x", label: "L".repeat(5000) }));
		expect(parsed?.label.length).toBe(1024);
	});

	it("ignores non-string fields rather than throwing", () => {
		const parsed = parseEntityDragPayload(
			JSON.stringify({ entityId: "ok", entityType: 42, label: { a: 1 } }),
		);
		expect(parsed).toEqual({ entityId: "ok", entityType: "", label: "" });
	});

	it("exposes the canonical MIME type", () => {
		expect(ENTITY_DRAG_MIME).toBe("application/vnd.brainstorm.entity+json");
	});
});

describe("object-drag multi-item hardening (DND-1)", () => {
	it("hardenObjectDragItem clamps fields and returns null without an id", () => {
		expect(hardenObjectDragItem({ entityId: "e1", entityType: "t", label: "L" })).toEqual({
			entityId: "e1",
			entityType: "t",
			label: "L",
		});
		expect(hardenObjectDragItem({ entityId: "", entityType: "t", label: "L" })).toBeNull();
		expect(hardenObjectDragItem(null)).toBeNull();
		expect(hardenObjectDragItem("nope")).toBeNull();
	});

	it("strips control/bidi characters from item fields", () => {
		const item = hardenObjectDragItem({
			entityId: "e1",
			entityType: "t",
			label: "ev‮il​",
		});
		expect(item?.label).toBe("evil");
	});

	it("drops the iconRef key when empty", () => {
		const item = hardenObjectDragItem({ entityId: "e1", entityType: "t", label: "L", iconRef: "" });
		expect(item).not.toHaveProperty("iconRef");
		const withIcon = hardenObjectDragItem({
			entityId: "e1",
			entityType: "t",
			label: "L",
			iconRef: "📄",
		});
		expect(withIcon?.iconRef).toBe("📄");
	});

	it("hardenObjectDragItems dedupes by entityId (first wins) and drops malformed", () => {
		const out = hardenObjectDragItems([
			{ entityId: "e1", entityType: "t", label: "first" },
			{ entityId: "e1", entityType: "t", label: "dup" },
			{ entityId: "e2", entityType: "t", label: "second" },
			{ entityId: "", entityType: "t", label: "no-id" },
			42,
		]);
		expect(out.map((i) => i.entityId)).toEqual(["e1", "e2"]);
		expect(out[0]?.label).toBe("first");
	});

	it("hardenObjectDragItems returns [] for a non-array", () => {
		expect(hardenObjectDragItems(null)).toEqual([]);
		expect(hardenObjectDragItems("x")).toEqual([]);
	});

	it("hardenObjectDragItems clamps the count to MAX_DRAG_ITEMS", () => {
		const many = Array.from({ length: MAX_DRAG_ITEMS + 50 }, (_, i) => ({
			entityId: `e${i}`,
			entityType: "t",
			label: `L${i}`,
		}));
		expect(hardenObjectDragItems(many)).toHaveLength(MAX_DRAG_ITEMS);
	});
});

/** Minimal Map-backed `DataTransfer` for the node test env (no jsdom). */
class FakeDataTransfer {
	private readonly store = new Map<string, string>();
	dropEffect = "none";
	setData(type: string, value: string): void {
		this.store.set(type, value);
	}
	getData(type: string): string {
		return this.store.get(type) ?? "";
	}
	get types(): string[] {
		return [...this.store.keys()];
	}
}

describe("widened ObjectDragPayload wire (DND-3)", () => {
	it("round-trips a multi-item payload through serialize/parse", () => {
		const wire = serializeObjectDragPayload({
			v: 1,
			sourceApp: "io.brainstorm.files",
			items: [
				{ entityId: "a", entityType: "T", label: "A" },
				{ entityId: "b", entityType: "T", label: "B", iconRef: "📄" },
			],
		});
		const parsed = parseObjectDragPayload(wire);
		expect(parsed?.items).toHaveLength(2);
		expect(parsed?.sourceApp).toBe("io.brainstorm.files");
		expect(parsed?.items[1]?.iconRef).toBe("📄");
	});

	it("dedupes by entityId and drops malformed items on parse", () => {
		const parsed = parseObjectDragPayload(
			JSON.stringify({
				items: [{ entityId: "a", label: "A" }, { entityId: "a", label: "dup" }, { label: "no id" }],
			}),
		);
		expect(parsed?.items).toHaveLength(1);
		expect(parsed?.items[0]?.label).toBe("A");
	});

	it("reads a LEGACY single-item payload as a one-item list (back-compat)", () => {
		const legacy = serializeEntityDragPayload(BASE);
		const parsed = parseObjectDragPayload(legacy);
		expect(parsed?.items).toEqual([BASE]);
		expect(parsed?.sourceApp).toBe(""); // native single-item carries no source
	});

	it("returns null for malformed / empty payloads", () => {
		expect(parseObjectDragPayload("not json")).toBeNull();
		expect(parseObjectDragPayload(JSON.stringify({ items: [] }))).toBeNull();
		expect(parseObjectDragPayload(JSON.stringify({ items: [{ label: "x" }] }))).toBeNull();
		expect(parseObjectDragPayload(null)).toBeNull();
	});

	it("setObjectDragData stamps the MIME + a newline-joined text/plain fallback", () => {
		const dt = new FakeDataTransfer() as unknown as DataTransfer;
		setObjectDragData(dt, {
			v: 1,
			sourceApp: "x",
			items: [
				{ entityId: "a", entityType: "T", label: "Alpha" },
				{ entityId: "b", entityType: "T", label: "Beta" },
			],
		});
		expect(dt.getData("text/plain")).toBe("Alpha\nBeta");
		const back = readObjectDragData(dt);
		expect(back?.items.map((i) => i.entityId)).toEqual(["a", "b"]);
	});

	it("objectDragItemTypes dedupes entity types", () => {
		expect(
			objectDragItemTypes([
				{ entityId: "a", entityType: "T1", label: "A" },
				{ entityId: "b", entityType: "T1", label: "B" },
				{ entityId: "c", entityType: "T2", label: "C" },
			]),
		).toEqual(["T1", "T2"]);
	});
});
