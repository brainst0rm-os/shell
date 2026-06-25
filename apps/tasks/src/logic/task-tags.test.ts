import { describe, expect, it } from "vitest";
import { Priority, type Task } from "../types/task";
import { addTag, allTags, normalizeTag, removeTag, tagsOf, tasksWithTag } from "./task-tags";

function task(id: string, tags?: string[]): Task {
	return {
		id,
		name: id,
		completedAt: null,
		priority: Priority.None,
		scheduledAt: null,
		dueAt: null,
		projectId: null,
		assigneeId: null,
		parentId: null,
		recurrence: null,
		statusKey: null,
		createdAt: 0,
		updatedAt: 0,
		...(tags ? { tags } : {}),
	};
}

describe("task-tags", () => {
	it("normalizeTag trims, collapses whitespace, lower-cases", () => {
		expect(normalizeTag("  Urgent ")).toBe("urgent");
		expect(normalizeTag("High   Priority")).toBe("high priority");
		expect(normalizeTag("   ")).toBe("");
	});

	it("tagsOf normalises absent to []", () => {
		expect(tagsOf(task("a"))).toEqual([]);
		expect(tagsOf(task("a", ["x"]))).toEqual(["x"]);
	});

	it("addTag appends normalised + de-duped, blank is a no-op", () => {
		expect(addTag([], "Urgent")).toEqual(["urgent"]);
		expect(addTag(["urgent"], "URGENT")).toEqual(["urgent"]);
		expect(addTag(["urgent"], "  ")).toEqual(["urgent"]);
		expect(addTag(["urgent"], "later")).toEqual(["urgent", "later"]);
	});

	it("removeTag drops the normalised match", () => {
		expect(removeTag(["urgent", "later"], "URGENT")).toEqual(["later"]);
		expect(removeTag(["urgent"], "nope")).toEqual(["urgent"]);
	});

	it("allTags lists distinct tags in first-seen order", () => {
		expect(allTags([task("a", ["x", "y"]), task("b", ["y", "z"]), task("c")])).toEqual([
			"x",
			"y",
			"z",
		]);
	});

	it("tasksWithTag filters by normalised tag", () => {
		const tasks = [task("a", ["urgent"]), task("b", ["later"]), task("c", ["urgent", "x"])];
		expect(tasksWithTag(tasks, "URGENT").map((t) => t.id)).toEqual(["a", "c"]);
		expect(tasksWithTag(tasks, "none")).toEqual([]);
	});
});
