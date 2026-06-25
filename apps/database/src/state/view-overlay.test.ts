import { describe, expect, it } from "vitest";
import type { ColumnSpec, ListView } from "../types/list-view";
import { ListViewKind } from "../types/list-view";
import { mergeOverlay, viewOverrideOf } from "./view-overlay";

const COL = (propertyId: string, width = 160): ColumnSpec => ({
	propertyId,
	width,
	visible: true,
});

function makeView(overrides: Partial<ListView> = {}): ListView {
	return {
		id: "vw_1",
		listId: "ls_1",
		name: "All",
		kind: ListViewKind.Grid,
		columns: [COL("status"), COL("priority"), COL("due")],
		sorts: [],
		filters: null,
		groupBy: null,
		layoutOptions: { rowHeight: "comfortable", showRowNumbers: false, pinFirstColumn: true },
		...overrides,
	} as ListView;
}

describe("viewOverrideOf — snapshot the persistable subset of a view", () => {
	it("captures every user-tweakable field", () => {
		const v = makeView();
		const o = viewOverrideOf(v);
		expect(o).toEqual({
			name: "All",
			kind: ListViewKind.Grid,
			layoutOptions: { rowHeight: "comfortable", showRowNumbers: false, pinFirstColumn: true },
			columns: v.columns,
			sorts: [],
			filters: null,
			groupBy: null,
		});
	});

	it("includes manualOrder only when defined", () => {
		const without = viewOverrideOf(makeView());
		expect(without).not.toHaveProperty("manualOrder");
		const with_ = viewOverrideOf(makeView({ manualOrder: ["ent_a", "ent_b"] }));
		expect(with_.manualOrder).toEqual(["ent_a", "ent_b"]);
	});

	it("reflects a column-reorder on the live view (the bug-path the closeout test below exercises)", () => {
		const v = makeView();
		// Simulate the dnd-kit onDragEnd → updateViewColumns path: mutate
		// state.views[idx].columns to the new order.
		v.columns = [COL("due"), COL("priority"), COL("status")];
		const o = viewOverrideOf(v);
		expect(o.columns?.map((c) => c.propertyId)).toEqual(["due", "priority", "status"]);
	});
});

describe("mergeOverlay — re-attach overlay onto a rebuilt vault-derived view", () => {
	it("returns the rebuilt view unchanged when no overlay is present (vault is the source of truth)", () => {
		const v = makeView();
		const merged = mergeOverlay(v, undefined);
		expect(merged).toBe(v);
	});

	it("overlays the column order onto the rebuilt view (the survives-onChange contract)", () => {
		const rebuilt = makeView(); // fresh from buildVaultLists
		const overlay = viewOverrideOf(
			makeView({
				columns: [COL("due"), COL("priority"), COL("status")],
			}),
		);
		const merged = mergeOverlay(rebuilt, overlay);
		expect(merged.columns.map((c) => c.propertyId)).toEqual(["due", "priority", "status"]);
		// All other fields stay at the rebuilt values (overlay didn't change them).
		expect(merged.id).toBe(rebuilt.id);
		expect(merged.listId).toBe(rebuilt.listId);
	});

	it("overlays sorts/filters/groupBy/kind/layout without touching unrelated fields", () => {
		const rebuilt = makeView();
		const overlay: ReturnType<typeof viewOverrideOf> = {
			kind: ListViewKind.Board,
			groupBy: { propertyId: "status" } as ListView["groupBy"],
			sorts: [{ propertyId: "priority", direction: "asc" } as ListView["sorts"][number]],
			filters: null,
		};
		const merged = mergeOverlay(rebuilt, overlay);
		expect(merged.kind).toBe(ListViewKind.Board);
		expect(merged.groupBy).toEqual({ propertyId: "status" });
		expect(merged.sorts).toEqual([{ propertyId: "priority", direction: "asc" }]);
		expect(merged.columns).toBe(rebuilt.columns); // untouched
	});
});

describe("9.12.R1 regression — column reorder survives a vault onChange rebuild", () => {
	/**
	 * Reproduce-first symptom (workflow rule 4, plan §9.12.R1):
	 * before R1's persistedUserDeltas.viewOverrides synchronous refresh
	 * (app.ts:2683 in `schedulePersist`), a column reorder + concurrent
	 * vault `onChange` would silently revert mid-session because
	 * `applyVaultSnapshot` re-layered the stale boot-time overrides.
	 *
	 * This test exercises the merge path through viewOverrideOf +
	 * mergeOverlay; the in-app `schedulePersist` keeps the overlay map
	 * current synchronously, so the rebuild always sees the latest order.
	 */
	it("reorder → overlay-refresh → rebuild → order preserved", () => {
		// Step 1: vault returns the canonical view via buildVaultLists.
		const original = makeView();
		expect(original.columns.map((c) => c.propertyId)).toEqual(["status", "priority", "due"]);

		// Step 2: user reorders columns via dnd-kit onDragEnd; app.ts
		// flips state.views[idx].columns to the new order.
		const live: ListView = {
			...original,
			columns: [COL("due"), COL("priority"), COL("status")],
		};

		// Step 3: schedulePersist's synchronous half — refresh the
		// overlay BEFORE the disk write debounces. This is the load-bearing
		// line at app.ts:2683 that prevents the rebuild from reverting.
		const overlay = viewOverrideOf(live);

		// Step 4: vault `onChange` fires (e.g. another window writes an
		// unrelated entity). buildVaultLists regenerates the same canonical
		// view from scratch — its columns are back to the original
		// [status, priority, due].
		const rebuilt = makeView();

		// Step 5: applyVaultSnapshot merges the overlay onto the rebuilt
		// view. The user's reorder MUST survive.
		const final = mergeOverlay(rebuilt, overlay);
		expect(final.columns.map((c) => c.propertyId)).toEqual(["due", "priority", "status"]);
	});

	it("reorder lost without overlay refresh (negative control — proves the test catches the bug)", () => {
		const original = makeView();
		const live: ListView = {
			...original,
			columns: [COL("due"), COL("priority"), COL("status")],
		};
		// Simulate the pre-R1 bug: overlay was NOT refreshed before the
		// rebuild, so mergeOverlay receives an empty overlay.
		const staleOverlay = undefined;
		const rebuilt = makeView();
		const final = mergeOverlay(rebuilt, staleOverlay);
		// Without the refresh, the live reorder is lost — this is the
		// symptom the synchronous refresh in schedulePersist prevents.
		expect(final.columns.map((c) => c.propertyId)).toEqual(["status", "priority", "due"]);
		expect(final.columns.map((c) => c.propertyId)).not.toEqual(live.columns.map((c) => c.propertyId));
	});
});
