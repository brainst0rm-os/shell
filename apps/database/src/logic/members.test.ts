/**
 * Tests for the members-override algorithm. The truth tables this test pins
 * down come from docs/apps/database/10-lists-sets-collections.md §Operations
 * on a List. The algorithm treats include and exclude as independent layers
 * of `effective(L) = ((sourceMatches) ∪ include) \ exclude`, so:
 *
 *   add(L, e):                                            outcome
 *     in exclude → drop from exclude                      UnExcluded
 *     then: !matchesSource AND !in include → append      Included
 *     (an UnExclude followed by an Include is reported   Included
 *      as the user-visible outcome, Include — see code.)
 *     otherwise                                            NoOp
 *
 *   remove(L, e):                                          outcome
 *     in include → drop from include                      UnIncluded
 *     then: matchesSource AND !in exclude → append        Excluded
 *     (a UnInclude followed by an Exclude is reported     Excluded
 *      as the user-visible outcome, Exclude.)
 *     otherwise                                            NoOp
 */

import { describe, expect, it } from "vitest";
import type { MemberOverrides } from "../types/list";
import { MEMBERS_HARD_CAP } from "../types/list";
import {
	AddOutcome,
	MembersCapacityError,
	RemoveOutcome,
	addToList,
	removeFromList,
} from "./members";

const empty: MemberOverrides = { include: [], exclude: [] };

const ctx = { by: "user" as const, now: 1_700_000_000_000 };

describe("addToList", () => {
	it("is a no-op when the source already matches", () => {
		const result = addToList(empty, "e1", { ...ctx, matchesSource: true });
		expect(result.outcome).toBe(AddOutcome.NoOp);
		expect(result.members).toBe(empty);
	});

	it("drops the entity from exclude when it was pinned out", () => {
		const start: MemberOverrides = {
			include: [],
			exclude: [{ entityId: "e1", removedAt: 1, by: "user" }],
		};
		const result = addToList(start, "e1", { ...ctx, matchesSource: true });

		expect(result.outcome).toBe(AddOutcome.UnExcluded);
		expect(result.members.exclude).toEqual([]);
		expect(result.members.include).toEqual([]);
	});

	it("appends to include when entity is not in exclude and not source-matched", () => {
		const result = addToList(empty, "e1", { ...ctx, matchesSource: false });
		expect(result.outcome).toBe(AddOutcome.Included);
		expect(result.members.include).toEqual([{ entityId: "e1", addedAt: ctx.now, by: "user" }]);
	});

	it("is a no-op when entity is already in include (idempotent)", () => {
		const start: MemberOverrides = {
			include: [{ entityId: "e1", addedAt: 1, by: "user" }],
			exclude: [],
		};
		const result = addToList(start, "e1", { ...ctx, matchesSource: false });
		expect(result.outcome).toBe(AddOutcome.NoOp);
		expect(result.members).toBe(start);
	});

	it("persists the optional reason when given", () => {
		const result = addToList(empty, "e1", {
			...ctx,
			matchesSource: false,
			reason: "shortlist pick",
		});
		expect(result.members.include[0]).toMatchObject({
			entityId: "e1",
			reason: "shortlist pick",
			by: "user",
		});
	});

	it("does not write a `reason` field when reason is undefined", () => {
		const result = addToList(empty, "e1", { ...ctx, matchesSource: false });
		expect(result.members.include[0]).not.toHaveProperty("reason");
	});

	it("uses Date.now() when ctx.now is not provided", () => {
		const before = Date.now();
		const result = addToList(empty, "e1", { matchesSource: false, by: "user" });
		const after = Date.now();
		const t = result.members.include[0]?.addedAt ?? -1;
		expect(t).toBeGreaterThanOrEqual(before);
		expect(t).toBeLessThanOrEqual(after);
	});

	it("throws MembersCapacityError when adding would exceed the hard cap", () => {
		const full: MemberOverrides = {
			include: Array.from({ length: MEMBERS_HARD_CAP }, (_, i) => ({
				entityId: `e${i}`,
				addedAt: 1,
				by: "user" as const,
			})),
			exclude: [],
		};
		expect(() => addToList(full, "new", { ...ctx, matchesSource: false })).toThrow(
			MembersCapacityError,
		);
	});

	it("does not throw when the new entity un-excludes (no net growth)", () => {
		const oversize: MemberOverrides = {
			include: Array.from({ length: MEMBERS_HARD_CAP - 1 }, (_, i) => ({
				entityId: `e${i}`,
				addedAt: 1,
				by: "user" as const,
			})),
			exclude: [{ entityId: "evicted", removedAt: 1, by: "user" }],
		};
		const result = addToList(oversize, "evicted", {
			...ctx,
			matchesSource: true,
		});
		expect(result.outcome).toBe(AddOutcome.UnExcluded);
	});
});

describe("removeFromList", () => {
	it("drops the entity from include when it was pinned in", () => {
		const start: MemberOverrides = {
			include: [{ entityId: "e1", addedAt: 1, by: "user" }],
			exclude: [],
		};
		const result = removeFromList(start, "e1", {
			...ctx,
			matchesSource: false,
		});
		expect(result.outcome).toBe(RemoveOutcome.UnIncluded);
		expect(result.members.include).toEqual([]);
	});

	it("appends to exclude when source matches and entity is not in include", () => {
		const result = removeFromList(empty, "e1", { ...ctx, matchesSource: true });
		expect(result.outcome).toBe(RemoveOutcome.Excluded);
		expect(result.members.exclude).toEqual([{ entityId: "e1", removedAt: ctx.now, by: "user" }]);
	});

	it("is a no-op when source does not match and entity is not in include", () => {
		const result = removeFromList(empty, "e1", { ...ctx, matchesSource: false });
		expect(result.outcome).toBe(RemoveOutcome.NoOp);
		expect(result.members).toBe(empty);
	});

	it("is a no-op when entity is already excluded (idempotent)", () => {
		const start: MemberOverrides = {
			include: [],
			exclude: [{ entityId: "e1", removedAt: 1, by: "user" }],
		};
		const result = removeFromList(start, "e1", { ...ctx, matchesSource: true });
		expect(result.outcome).toBe(RemoveOutcome.NoOp);
		expect(result.members).toBe(start);
	});

	it("drops from include AND appends to exclude when entity was pinned in and matchesSource", () => {
		// Without the exclude, dropping include alone leaves the entity in
		// effective(L) via source-match. The remove has to write both sides.
		const start: MemberOverrides = {
			include: [{ entityId: "e1", addedAt: 1, by: "user" }],
			exclude: [],
		};
		const result = removeFromList(start, "e1", { ...ctx, matchesSource: true });
		expect(result.outcome).toBe(RemoveOutcome.Excluded);
		expect(result.members.include).toEqual([]);
		expect(result.members.exclude).toEqual([{ entityId: "e1", removedAt: ctx.now, by: "user" }]);
	});

	it("persists the optional reason on the exclude record when given", () => {
		const result = removeFromList(empty, "e1", {
			...ctx,
			matchesSource: true,
			reason: "out of scope",
		});
		expect(result.outcome).toBe(RemoveOutcome.Excluded);
		expect(result.members.exclude[0]).toMatchObject({
			entityId: "e1",
			reason: "out of scope",
			by: "user",
		});
	});

	it("throws MembersCapacityError when exclude would exceed the hard cap", () => {
		const full: MemberOverrides = {
			include: [],
			exclude: Array.from({ length: MEMBERS_HARD_CAP }, (_, i) => ({
				entityId: `e${i}`,
				removedAt: 1,
				by: "user" as const,
			})),
		};
		expect(() => removeFromList(full, "new", { ...ctx, matchesSource: true })).toThrow(
			MembersCapacityError,
		);
	});
});

describe("round-trip invariants", () => {
	it("add then remove with the same matchesSource returns to the original shape", () => {
		// matchesSource = false → Include then UnInclude
		const after = addToList(empty, "e1", { ...ctx, matchesSource: false });
		const back = removeFromList(after.members, "e1", {
			...ctx,
			matchesSource: false,
		});
		expect(back.members).toEqual(empty);
	});

	it("remove then add with matchesSource = true returns to the original shape", () => {
		// matchesSource = true → Exclude then UnExclude
		const after = removeFromList(empty, "e1", { ...ctx, matchesSource: true });
		const back = addToList(after.members, "e1", { ...ctx, matchesSource: true });
		expect(back.members).toEqual(empty);
	});
});
