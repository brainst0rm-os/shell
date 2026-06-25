import { describe, expect, it } from "vitest";
import { InitialNoteAction, pickInitialNote } from "./pick-initial-note";

const has = (...ids: string[]) => {
	const set = new Set(ids);
	return (id: string) => set.has(id);
};

describe("pickInitialNote", () => {
	it("a cross-app open-entity launch wins over everything", () => {
		expect(
			pickInitialNote({
				hasLaunchEntity: true,
				launchEntityId: "wanted",
				lastOpenId: "last",
				hasNote: has("wanted", "last", "recent"),
				mostRecentId: "recent",
			}),
		).toEqual({ action: InitialNoteAction.OpenEntity, entityId: "wanted" });
	});

	it("restores the last-open note on refresh when it still exists (the reported bug)", () => {
		expect(
			pickInitialNote({
				hasLaunchEntity: false,
				launchEntityId: null,
				lastOpenId: "last",
				hasNote: has("last", "recent"),
				mostRecentId: "recent",
			}),
		).toEqual({ action: InitialNoteAction.Select, id: "last" });
	});

	it("falls back to most-recent when the persisted note no longer exists (deleted / vault switch)", () => {
		expect(
			pickInitialNote({
				hasLaunchEntity: false,
				launchEntityId: null,
				lastOpenId: "gone",
				hasNote: has("recent"),
				mostRecentId: "recent",
			}),
		).toEqual({ action: InitialNoteAction.Select, id: "recent" });
	});

	it("falls back to most-recent when nothing was ever persisted (first run)", () => {
		expect(
			pickInitialNote({
				hasLaunchEntity: false,
				launchEntityId: null,
				lastOpenId: null,
				hasNote: has("recent"),
				mostRecentId: "recent",
			}),
		).toEqual({ action: InitialNoteAction.Select, id: "recent" });
	});

	it("an open-entity launch with an empty id is ignored, restore still applies", () => {
		expect(
			pickInitialNote({
				hasLaunchEntity: true,
				launchEntityId: "",
				lastOpenId: "last",
				hasNote: has("last"),
				mostRecentId: "recent",
			}),
		).toEqual({ action: InitialNoteAction.Select, id: "last" });
	});

	it("None when the vault has no notes and nothing to restore", () => {
		expect(
			pickInitialNote({
				hasLaunchEntity: false,
				launchEntityId: null,
				lastOpenId: null,
				hasNote: has(),
				mostRecentId: null,
			}),
		).toEqual({ action: InitialNoteAction.None });
	});
});
