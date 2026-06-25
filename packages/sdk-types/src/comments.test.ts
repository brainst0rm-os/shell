import { describe, expect, it } from "vitest";
import {
	type CommentDef,
	CommentIssueCode,
	CommentKind,
	CommentStatus,
	buildThreads,
	commentStatus,
	isCommentKind,
	isValidComment,
	openThreadCount,
	threadCommentIds,
	threadKeyFor,
	validateComment,
} from "./comments";

function comment(over: Partial<CommentDef> = {}): CommentDef {
	return {
		id: "cmt_1",
		kind: CommentKind.Comment,
		anchor: { entityId: "ent_doc", blockId: "blk_1" },
		body: "looks good",
		parentId: null,
		createdAt: 100,
		updatedAt: 100,
		resolvedAt: null,
		...over,
	};
}

describe("validateComment", () => {
	it("accepts a well-formed comment", () => {
		expect(validateComment(comment())).toEqual([]);
		expect(isValidComment(comment())).toBe(true);
	});

	it("flags an empty / whitespace-only body", () => {
		expect(validateComment(comment({ body: "   " })).map((i) => i.code)).toContain(
			CommentIssueCode.EmptyBody,
		);
	});

	it("flags a missing entity or block anchor", () => {
		const codes = validateComment(comment({ anchor: { entityId: "", blockId: "" } })).map(
			(i) => i.code,
		);
		expect(codes).toContain(CommentIssueCode.MissingEntityRef);
		expect(codes).toContain(CommentIssueCode.MissingBlockRef);
	});

	it("flags an unknown kind", () => {
		const codes = validateComment(comment({ kind: "bogus" as never })).map((i) => i.code);
		expect(codes).toContain(CommentIssueCode.InvalidKind);
	});

	it("flags a malformed anchor range", () => {
		const codes = validateComment(
			comment({ anchor: { entityId: "ent_doc", blockId: "blk_1", range: { start: 5, end: 2 } } }),
		).map((i) => i.code);
		expect(codes).toContain(CommentIssueCode.InvalidRange);
	});

	it("accepts a valid anchor range", () => {
		expect(
			isValidComment(
				comment({ anchor: { entityId: "ent_doc", blockId: "blk_1", range: { start: 2, end: 5 } } }),
			),
		).toBe(true);
	});

	it("requires a payload on a suggestion", () => {
		expect(validateComment(comment({ kind: CommentKind.Suggestion })).map((i) => i.code)).toContain(
			CommentIssueCode.MissingSuggestion,
		);
		expect(
			isValidComment(comment({ kind: CommentKind.Suggestion, suggestion: { replacement: "fixed" } })),
		).toBe(true);
	});

	it("rejects a reply that carries its own resolution", () => {
		expect(
			validateComment(comment({ parentId: "cmt_root", resolvedAt: 200 })).map((i) => i.code),
		).toContain(CommentIssueCode.ReplyCannotResolve);
	});
});

describe("isCommentKind", () => {
	it("guards the kind union", () => {
		expect(isCommentKind("comment")).toBe(true);
		expect(isCommentKind("suggestion")).toBe(true);
		expect(isCommentKind("note")).toBe(false);
	});
});

describe("commentStatus", () => {
	it("derives open / resolved from resolvedAt", () => {
		expect(commentStatus(comment())).toBe(CommentStatus.Open);
		expect(commentStatus(comment({ resolvedAt: 200 }))).toBe(CommentStatus.Resolved);
	});
});

describe("threadKeyFor", () => {
	it("keys by entity + block so same-block comments group", () => {
		expect(threadKeyFor({ entityId: "ent_doc", blockId: "blk_1" })).toBe("ent_doc#blk_1");
		expect(threadKeyFor({ entityId: "ent_doc", blockId: "blk_2" })).not.toBe(
			threadKeyFor({ entityId: "ent_doc", blockId: "blk_1" }),
		);
	});
});

describe("buildThreads", () => {
	it("nests replies under their root, both sorted oldest-first", () => {
		const root = comment({ id: "r1", createdAt: 10 });
		const reply2 = comment({ id: "p2", parentId: "r1", createdAt: 30 });
		const reply1 = comment({ id: "p1", parentId: "r1", createdAt: 20 });
		const threads = buildThreads([reply2, root, reply1]);
		expect(threads).toHaveLength(1);
		expect(threads[0]?.root.id).toBe("r1");
		expect(threads[0]?.replies.map((c) => c.id)).toEqual(["p1", "p2"]);
	});

	it("sorts roots oldest-first", () => {
		const later = comment({ id: "r2", createdAt: 50 });
		const earlier = comment({ id: "r1", createdAt: 10 });
		expect(buildThreads([later, earlier]).map((t) => t.root.id)).toEqual(["r1", "r2"]);
	});

	it("promotes an orphan reply (missing root) to its own thread, dropping nothing", () => {
		const orphan = comment({ id: "p1", parentId: "gone", createdAt: 20 });
		const threads = buildThreads([orphan]);
		expect(threads).toHaveLength(1);
		expect(threads[0]?.root.id).toBe("p1");
	});

	it("carries the root's resolution as the thread status", () => {
		const root = comment({ id: "r1", resolvedAt: 99 });
		const reply = comment({ id: "p1", parentId: "r1" });
		expect(buildThreads([root, reply])[0]?.status).toBe(CommentStatus.Resolved);
	});
});

describe("openThreadCount", () => {
	it("counts only unresolved threads", () => {
		const open = comment({ id: "r1" });
		const resolved = comment({ id: "r2", resolvedAt: 5 });
		const reply = comment({ id: "p1", parentId: "r1" });
		expect(openThreadCount([open, resolved, reply])).toBe(1);
	});
});

describe("threadCommentIds", () => {
	it("returns the root plus every reply id", () => {
		const [thread] = buildThreads([
			comment({ id: "r1" }),
			comment({ id: "p1", parentId: "r1" }),
			comment({ id: "p2", parentId: "r1" }),
		]);
		expect(thread && threadCommentIds(thread)).toEqual(["r1", "p1", "p2"]);
	});
});
