import { describe, expect, it } from "vitest";
import { IconKind } from "./index";
import { GENERIC_TYPE_ICON, defaultIconForType } from "./type-icon";

describe("defaultIconForType", () => {
	it("resolves the canonical first-party type ids by exact match", () => {
		expect(defaultIconForType("brainstorm/Task/v1")).toEqual({
			kind: IconKind.Emoji,
			value: "📋",
		});
		expect(defaultIconForType("brainstorm/Project/v1").value).toBe("📁");
		expect(defaultIconForType("brainstorm/Event/v1").value).toBe("📅");
		expect(defaultIconForType("io.brainstorm.notes/Note/v1").value).toBe("📝");
		expect(defaultIconForType("brainstorm/Iteration/v1").value).toBe("🔄");
	});

	it("REGRESSION: Task/Project/Event resolve to a real icon, never the old anonymous dot", () => {
		// The exact failure: these had no entry in the Graph's private
		// typeGlyph map and fell to `●`, rendering as bare discs.
		for (const t of ["brainstorm/Task/v1", "brainstorm/Project/v1", "brainstorm/Event/v1"]) {
			const icon = defaultIconForType(t);
			expect(icon.kind).toBe(IconKind.Emoji);
			expect(icon.value).not.toBe("");
			expect(icon.value).not.toBe("●");
		}
	});

	it("resolves arbitrary namespaced variants by suffix match", () => {
		expect(defaultIconForType("io.example/Person/v1").value).toBe("👤");
		expect(defaultIconForType("acme.crm/Task/v3").value).toBe("📋");
		expect(defaultIconForType("x/Note").value).toBe("📝");
		expect(defaultIconForType("io.x/Whiteboard/v1").value).toBe("🖼️");
	});

	it("is case-insensitive on the suffix", () => {
		expect(defaultIconForType("io.x/TASK/v1").value).toBe("📋");
	});

	it("returns a visible generic fallback for a genuinely unknown type", () => {
		const icon = defaultIconForType("io.weird/Quux/v9");
		expect(icon).toEqual(GENERIC_TYPE_ICON);
		expect(icon.value).toBe("📦");
		expect(icon.value).not.toBe("●");
	});

	it("never returns null/empty for any input (a node is never iconless)", () => {
		for (const t of ["", "no-slashes", "/", "a/b/c/d/e"]) {
			const icon = defaultIconForType(t);
			expect(icon.kind).toBe(IconKind.Emoji);
			expect(icon.value.length).toBeGreaterThan(0);
		}
	});
});
