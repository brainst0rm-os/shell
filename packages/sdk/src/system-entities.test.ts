import { describe, expect, it } from "vitest";
import { SYSTEM_ENTITY_TYPES, SystemEntityType, isSystemEntityType } from "./system-entities";

describe("system entity types", () => {
	it("classifies infrastructure records as system", () => {
		expect(isSystemEntityType(SystemEntityType.BrowsingHistory)).toBe(true);
		expect(isSystemEntityType(SystemEntityType.BrowsingSession)).toBe(true);
		expect(isSystemEntityType(SystemEntityType.ListView)).toBe(true);
		expect(isSystemEntityType(SystemEntityType.Trigger)).toBe(true);
		expect(isSystemEntityType(SystemEntityType.Workflow)).toBe(true);
		expect(isSystemEntityType(SystemEntityType.WorkflowRun)).toBe(true);
		expect(isSystemEntityType(SystemEntityType.ShortcutBindings)).toBe(true);
		expect(isSystemEntityType(SystemEntityType.SyncRun)).toBe(true);
		expect(isSystemEntityType(SystemEntityType.GraphExport)).toBe(true);
	});

	it("keeps user content out — deliberate creations are never system", () => {
		for (const type of [
			"brainstorm/Note/v1",
			"brainstorm/Task/v1",
			"brainstorm/Reminder/v1",
			"brainstorm/StylePack/v1",
			"brainstorm/Bookmark/v1",
			"brainstorm/List/v1",
			"brainstorm/Object/v1",
			"brainstorm/Person/v1",
			"io.brainstorm.journal/Entry/v1",
			"",
		]) {
			expect(isSystemEntityType(type), type).toBe(false);
		}
	});

	it("exposes the full catalogue as a set matching the const object", () => {
		expect(SYSTEM_ENTITY_TYPES.size).toBe(Object.values(SystemEntityType).length);
		for (const type of Object.values(SystemEntityType)) {
			expect(SYSTEM_ENTITY_TYPES.has(type)).toBe(true);
		}
	});
});
