import { describe, expect, it } from "vitest";
import {
	ActionGroup,
	ActionTrustTier,
	type ContributedAction,
	ContributedVerb,
	INLINE_ACTIONS_PER_GROUP,
	contributedActionId,
	groupContributedActions,
	groupForVerb,
} from "./index";

function action(over: Partial<ContributedAction> & { appId: string }): ContributedAction {
	const verb = over.verb ?? ContributedVerb.Process;
	return {
		id: contributedActionId(verb, over.kind, over.appId),
		verb,
		label: over.label ?? "Do thing",
		group: over.group ?? groupForVerb(verb),
		priority: over.priority ?? "secondary",
		trustTier: over.trustTier ?? ActionTrustTier.Trusted,
		appLabel: over.appLabel ?? over.appId,
		...over,
	};
}

describe("groupForVerb", () => {
	it("maps verbs to buckets", () => {
		expect(groupForVerb(ContributedVerb.Share)).toBe(ActionGroup.Share);
		expect(groupForVerb(ContributedVerb.Convert)).toBe(ActionGroup.Convert);
		expect(groupForVerb(ContributedVerb.Export)).toBe(ActionGroup.Convert);
		expect(groupForVerb(ContributedVerb.Process)).toBe(ActionGroup.Actions);
		expect(groupForVerb(ContributedVerb.Compose)).toBe(ActionGroup.Actions);
		expect(groupForVerb("nonsense")).toBe(ActionGroup.Actions);
	});
});

describe("groupContributedActions", () => {
	it("returns groups in the canonical Share → Convert → Actions order", () => {
		const groups = groupContributedActions([
			action({ appId: "a", verb: ContributedVerb.Process }),
			action({ appId: "b", verb: ContributedVerb.Share }),
			action({ appId: "c", verb: ContributedVerb.Convert }),
		]);
		expect(groups.map((g) => g.group)).toEqual([
			ActionGroup.Share,
			ActionGroup.Convert,
			ActionGroup.Actions,
		]);
	});

	it("caps inline at INLINE_ACTIONS_PER_GROUP and overflows the rest", () => {
		const many = Array.from({ length: INLINE_ACTIONS_PER_GROUP + 2 }, (_, i) =>
			action({ appId: `app-${i}`, kind: `k${i}` }),
		);
		const [group] = groupContributedActions(many);
		expect(group?.inline).toHaveLength(INLINE_ACTIONS_PER_GROUP);
		expect(group?.overflow).toHaveLength(2);
	});

	it("never places a sideloaded contribution inline (trust quarantine)", () => {
		const groups = groupContributedActions([
			action({ appId: "side", kind: "k1", trustTier: ActionTrustTier.Sideloaded }),
			action({ appId: "trusted", kind: "k2", trustTier: ActionTrustTier.Trusted }),
		]);
		const actions = groups[0];
		expect(actions?.inline.map((a) => a.appId)).toEqual(["trusted"]);
		expect(actions?.overflow.map((a) => a.appId)).toEqual(["side"]);
	});

	it("ranks primary before secondary, then trusted before sideloaded, then appId", () => {
		const groups = groupContributedActions([
			action({ appId: "z", kind: "k1", priority: "secondary" }),
			action({ appId: "a", kind: "k2", priority: "primary" }),
			action({ appId: "m", kind: "k3", priority: "secondary" }),
		]);
		expect(groups[0]?.inline.map((a) => a.appId)).toEqual(["a", "m", "z"]);
	});

	it("dedupes two apps registering the same (verb, kind) to the higher-ranked one", () => {
		const groups = groupContributedActions([
			action({ appId: "loser", kind: "summarize", priority: "secondary" }),
			action({ appId: "winner", kind: "summarize", priority: "primary" }),
		]);
		const all = [...(groups[0]?.inline ?? []), ...(groups[0]?.overflow ?? [])];
		expect(all).toHaveLength(1);
		expect(all[0]?.appId).toBe("winner");
	});

	it("returns [] for no actions", () => {
		expect(groupContributedActions([])).toEqual([]);
	});
});

describe("contributedActionId", () => {
	it("is stable and includes verb/kind/app", () => {
		expect(contributedActionId("process", "summarize", "io.x")).toBe("process:summarize:io.x");
		expect(contributedActionId("share", undefined, "io.y")).toBe("share::io.y");
	});
});
