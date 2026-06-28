import { describe, expect, it, vi } from "vitest";
import { PRIORITIES, Priority, TaskStatus } from "../types/task";
import type { Task } from "../types/task";
import {
	PRIORITY_DICT_ID,
	STATUS_DICT_ID,
	TAGS_DICT_ID,
	backfillTagDictionary,
	ensureTaskVocab,
	priorityDictionary,
	statusDictionary,
	tagsDictionary,
} from "./task-vocab";

function task(overrides: Partial<Task>): Task {
	return {
		id: "t1",
		name: "T",
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
		...overrides,
	};
}

describe("priorityDictionary", () => {
	it("uses Priority enum values as item ids in display order", () => {
		const dict = priorityDictionary();
		expect(dict.id).toBe(PRIORITY_DICT_ID);
		expect(dict.items.map((it) => it.id)).toEqual([...PRIORITIES]);
		expect(dict.items.map((it) => it.sortIndex)).toEqual(PRIORITIES.map((_, i) => i));
	});

	it("leaves None uncoloured but colours the rest", () => {
		const dict = priorityDictionary();
		const byId = new Map(dict.items.map((it) => [it.id, it]));
		expect(byId.get(Priority.None)?.colour).toBeUndefined();
		expect(byId.get(Priority.Critical)?.colour).toBeDefined();
	});
});

describe("statusDictionary", () => {
	it("uses statusKey strings as item ids", () => {
		const dict = statusDictionary();
		expect(dict.id).toBe(STATUS_DICT_ID);
		expect(dict.items.map((it) => it.id)).toEqual([
			TaskStatus.Todo,
			TaskStatus.InProgress,
			TaskStatus.Active,
			TaskStatus.Done,
			TaskStatus.Cancelled,
		]);
	});
});

describe("tagsDictionary", () => {
	it("seeds empty", () => {
		const dict = tagsDictionary();
		expect(dict.id).toBe(TAGS_DICT_ID);
		expect(dict.items).toHaveLength(0);
	});
});

describe("backfillTagDictionary", () => {
	it("unions new task tags as identity-id items, deduped", () => {
		const dict = tagsDictionary();
		const next = backfillTagDictionary(dict, [
			task({ tags: ["urgent", "home"] }),
			task({ tags: ["home", "errand"] }),
		]);
		expect(next).not.toBeNull();
		expect(next?.items.map((it) => it.id)).toEqual(["urgent", "home", "errand"]);
		expect(next?.items.every((it) => it.label === it.id)).toBe(true);
	});

	it("returns null when every tag is already present (idempotent)", () => {
		const seeded = backfillTagDictionary(tagsDictionary(), [task({ tags: ["a", "b"] })]);
		expect(seeded).not.toBeNull();
		const again = backfillTagDictionary(seeded ?? tagsDictionary(), [task({ tags: ["a", "b"] })]);
		expect(again).toBeNull();
	});

	it("continues sortIndex from existing items", () => {
		const seeded = backfillTagDictionary(tagsDictionary(), [task({ tags: ["a"] })]);
		const next = backfillTagDictionary(seeded ?? tagsDictionary(), [task({ tags: ["b"] })]);
		expect(next?.items.find((it) => it.id === "b")?.sortIndex).toBe(1);
	});
});

describe("ensureTaskVocab", () => {
	it("seeds every absent dictionary, skips present ones", async () => {
		const getDictionary = vi.fn().mockResolvedValue(null);
		const setDictionary = vi.fn().mockResolvedValue(undefined);
		await ensureTaskVocab({ getDictionary, setDictionary } as never);
		expect(setDictionary).toHaveBeenCalledTimes(3);
		const ids = setDictionary.mock.calls.map((c) => (c[0] as { id: string }).id);
		expect(ids).toEqual([PRIORITY_DICT_ID, STATUS_DICT_ID, TAGS_DICT_ID]);
	});

	it("does not overwrite an existing dictionary", async () => {
		const getDictionary = vi.fn().mockResolvedValue(statusDictionary());
		const setDictionary = vi.fn().mockResolvedValue(undefined);
		await ensureTaskVocab({ getDictionary, setDictionary } as never);
		expect(setDictionary).not.toHaveBeenCalled();
	});
});
