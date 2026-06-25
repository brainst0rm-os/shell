import { describe, expect, it } from "vitest";
import type { DashboardStore } from "./dashboard-store";
import { pruneOrphanAppIcons } from "./prune-orphan-app-icons";

type FakeIcon = { x: number; y: number; kind: string; target: string; label: string };

/** Minimal DashboardStore shim: the `snapshot().icons` + `removeIcon` the prune
 *  touches, cast to the real type (the rest is unused here). */
function fakeDashboard(icons: Record<string, FakeIcon>): {
	store: DashboardStore;
	icons: Record<string, FakeIcon>;
} {
	const store = {
		snapshot: () => ({ icons }),
		removeIcon: (id: string) => {
			delete icons[id];
		},
	} as unknown as DashboardStore;
	return { store, icons };
}

const icon = (kind: string, target: string): FakeIcon => ({
	x: 0,
	y: 0,
	kind,
	target,
	label: target,
});

describe("pruneOrphanAppIcons", () => {
	it("removes app icons whose target isn't installed, keeps the rest", () => {
		const { store, icons } = fakeDashboard({
			notes: icon("app", "io.brainstorm.notes"),
			codeEditor: icon("app", "io.brainstorm.code-editor"),
			ent: icon("entity", "ent_123"),
		});
		const removed = pruneOrphanAppIcons(store, new Set(["io.brainstorm.notes"]));
		expect(removed).toEqual(["io.brainstorm.code-editor"]);
		expect(Object.keys(icons).sort()).toEqual(["ent", "notes"]);
	});

	it("never touches non-app icons (entity / view / shell-surface)", () => {
		const { store, icons } = fakeDashboard({
			bin: icon("shell-surface", "bin"),
			view: icon("view", "view_1"),
		});
		expect(pruneOrphanAppIcons(store, new Set())).toEqual([]);
		expect(Object.keys(icons).sort()).toEqual(["bin", "view"]);
	});

	it("no-ops when every app icon is installed", () => {
		const { store } = fakeDashboard({ notes: icon("app", "io.brainstorm.notes") });
		expect(pruneOrphanAppIcons(store, new Set(["io.brainstorm.notes"]))).toEqual([]);
	});
});
