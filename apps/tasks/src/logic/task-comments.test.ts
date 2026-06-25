import { describe, expect, it } from "vitest";
import type { TaskComment } from "../types/task";
import { addComment, commentsOf, parseComments, removeComment } from "./task-comments";

const c = (id: string, body: string, at = 0): TaskComment => ({ id, body, at });

describe("task-comments", () => {
	it("commentsOf normalises absent to []", () => {
		expect(commentsOf(undefined)).toEqual([]);
		expect(commentsOf([c("1", "hi")])).toEqual([c("1", "hi")]);
	});

	it("addComment appends a trimmed body; blank is a no-op", () => {
		expect(addComment([], "  hello  ", "1", 100)).toEqual([c("1", "hello", 100)]);
		expect(addComment([c("1", "a")], "   ", "2", 200)).toEqual([c("1", "a")]);
	});

	it("removeComment drops by id", () => {
		expect(removeComment([c("1", "a"), c("2", "b")], "1")).toEqual([c("2", "b")]);
		expect(removeComment([c("1", "a")], "nope")).toEqual([c("1", "a")]);
	});

	it("parseComments keeps well-formed entries and drops malformed ones", () => {
		const raw = [
			{ id: "1", body: "ok", at: 100 },
			{ id: "", body: "no id", at: 1 },
			{ id: "2", body: 5, at: 1 },
			{ id: "3", body: "no at", at: Number.NaN },
			"not an object",
			{ id: "4", body: "good", at: 200 },
		];
		expect(parseComments(raw)).toEqual([c("1", "ok", 100), c("4", "good", 200)]);
		expect(parseComments(null)).toEqual([]);
	});
});
