/**
 * Tests for `deriveListMode` — the function whose output is the user-facing
 * Query / Manual / Hybrid badge. The three modes are defined in
 *  §The three modes.
 *
 * The truth table this test pins down (per the design table in that doc):
 *
 *   source   include   exclude   →  mode
 *   ─────────────────────────────────────────────
 *   null     any       any       →  Manual
 *   set      empty     empty     →  Query
 *   set      non-empty any       →  Hybrid
 *   set      any       non-empty →  Hybrid
 */

import { describe, expect, it } from "vitest";
import type { List, MemberOverrides } from "../types/list";
import { ListSourceKind } from "../types/list-source";
import { ListMode } from "../types/list-source";
import type { ListSource } from "../types/list-source";
import { deriveListMode } from "./list-mode";

const emptyMembers: MemberOverrides = { include: [], exclude: [] };

const byType: ListSource = {
	kind: ListSourceKind.ByType,
	types: ["io.example/Movie/v1"],
};

function makeList(
	source: ListSource | null,
	members: MemberOverrides,
): Pick<List, "source" | "members"> {
	return { source, members };
}

describe("deriveListMode", () => {
	it("returns Manual when source is null, regardless of overrides", () => {
		expect(deriveListMode(makeList(null, emptyMembers))).toBe(ListMode.Manual);
		expect(
			deriveListMode(
				makeList(null, {
					include: [{ entityId: "e1", addedAt: 1, by: "user" }],
					exclude: [],
				}),
			),
		).toBe(ListMode.Manual);
		expect(
			deriveListMode(
				makeList(null, {
					include: [],
					exclude: [{ entityId: "e1", removedAt: 1, by: "user" }],
				}),
			),
		).toBe(ListMode.Manual);
	});

	it("returns Query when source is set and overrides are empty", () => {
		expect(deriveListMode(makeList(byType, emptyMembers))).toBe(ListMode.Query);
	});

	it("returns Hybrid when source is set and include is non-empty", () => {
		const list = makeList(byType, {
			include: [{ entityId: "e1", addedAt: 1, by: "user" }],
			exclude: [],
		});
		expect(deriveListMode(list)).toBe(ListMode.Hybrid);
	});

	it("returns Hybrid when source is set and exclude is non-empty", () => {
		const list = makeList(byType, {
			include: [],
			exclude: [{ entityId: "e1", removedAt: 1, by: "user" }],
		});
		expect(deriveListMode(list)).toBe(ListMode.Hybrid);
	});

	it("returns Hybrid when both include and exclude are non-empty", () => {
		const list = makeList(byType, {
			include: [{ entityId: "e1", addedAt: 1, by: "user" }],
			exclude: [{ entityId: "e2", removedAt: 1, by: "user" }],
		});
		expect(deriveListMode(list)).toBe(ListMode.Hybrid);
	});
});
