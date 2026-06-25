/**
 * Contact-import dedupe + commit-plan keystone (9.12.16, second slice).
 * Proves email-then-name duplicate detection, the non-destructive merge
 * (union lists, fill-only scalars, never overwrite a curated name), and
 * that UI overrides resolve to the right create/update command list.
 */

import { describe, expect, it } from "vitest";
import type { PersonDraft } from "../src/logic/contact-import";
import {
	type ExistingPerson,
	ImportAction,
	commandsFor,
	findDuplicate,
	mergePersonProps,
	planImport,
	summarize,
} from "../src/logic/contact-import-plan";

const ada: ExistingPerson = {
	id: "p_ada",
	properties: { name: "Ada Okafor", email: ["ada@brainstorm.app"], company: "Brainstorm" },
};

describe("findDuplicate", () => {
	it("matches on email case-insensitively (the strong key)", () => {
		const d: PersonDraft = { name: "Totally Different", email: ["ADA@Brainstorm.App"] };
		expect(findDuplicate(d, [ada])?.id).toBe("p_ada");
	});
	it("falls back to normalized display name when no email overlap", () => {
		expect(findDuplicate({ name: "  ada   okafor " }, [ada])?.id).toBe("p_ada");
	});
	it("returns null for a genuinely new contact", () => {
		expect(findDuplicate({ name: "New Person", email: ["new@x.com"] }, [ada])).toBeNull();
	});
});

describe("mergePersonProps", () => {
	it("unions email/phone, fills missing scalars, never overwrites the name", () => {
		const merged = mergePersonProps(ada.properties, {
			name: "Ada O.",
			email: ["ada@brainstorm.app", "ada@personal.example"],
			phone: ["+1 555 0142"],
			role: "Founder",
			company: "Ignored Co",
		});
		expect(merged).toEqual({
			name: "Ada Okafor", // curated name preserved
			email: ["ada@brainstorm.app", "ada@personal.example"], // de-duped union
			phone: ["+1 555 0142"],
			company: "Brainstorm", // existing scalar kept (not overwritten)
			role: "Founder", // filled because absent
		});
	});
	it("adopts the draft name only when the existing one is blank", () => {
		expect(mergePersonProps({ name: "" }, { name: "Fresh" }).name).toBe("Fresh");
	});
});

describe("planImport", () => {
	it("defaults matched rows to Merge (with preview) and new rows to Create", () => {
		const plan = planImport(
			[
				{ name: "Ada Okafor", phone: ["+1 555 0142"] },
				{ name: "Kenji Ito", email: ["kenji@example.com"] },
			],
			[ada],
		);
		expect(plan[0]).toMatchObject({ action: ImportAction.Merge, matchId: "p_ada" });
		expect(plan[0]?.merged?.phone).toEqual(["+1 555 0142"]);
		expect(plan[1]).toMatchObject({ action: ImportAction.Create, matchId: null, merged: null });
	});
});

describe("commandsFor + summarize", () => {
	const plan = planImport(
		[
			{ name: "Ada Okafor", role: "Founder" }, // → merge p_ada
			{ name: "Kenji Ito", email: ["kenji@example.com"] }, // → create
		],
		[ada],
	);

	it("emits update for merges, create for new, nothing for skips", () => {
		expect(commandsFor(plan)).toEqual([
			{ op: "update", id: "p_ada", properties: expect.objectContaining({ role: "Founder" }) },
			{ op: "create", properties: { name: "Kenji Ito", email: ["kenji@example.com"] } },
		]);
		expect(summarize(plan)).toEqual({ create: 1, merge: 1, skip: 0 });
	});

	it("honours per-row UI overrides (skip the merge, force-create the dup)", () => {
		expect(commandsFor(plan, { 0: ImportAction.Skip })).toEqual([
			{ op: "create", properties: { name: "Kenji Ito", email: ["kenji@example.com"] } },
		]);
		const forced = commandsFor(plan, { 0: ImportAction.Create });
		expect(forced[0]).toEqual({ op: "create", properties: { name: "Ada Okafor", role: "Founder" } });
		expect(summarize(plan, { 0: ImportAction.Skip })).toEqual({ create: 1, merge: 0, skip: 1 });
	});
});
