import { describe, expect, it } from "vitest";
import { createQueryStore } from "./query-store";

/**
 * Regression: a store retained across an unmount→remount (React StrictMode in
 * dev runs the teardown effect on the simulated unmount, then re-subscribes the
 * SAME `useMemo`-retained instance on remount) must REVIVE on the new
 * subscriber. Before the fix, `subscribe()` returned a dead no-op once
 * `dispose()` had run, so `useVaultEntities` stayed pinned to its empty initial
 * snapshot forever — the graph (and every other StrictMode app) rendered as
 * permanently empty even though `list()` returned thousands of entities.
 */
describe("createQueryStore — StrictMode dispose→resubscribe revival", () => {
	type Snap = { entities: number[]; links: number[] };
	const DATA: Snap = { entities: [1, 2, 3], links: [] };
	const EMPTY: Snap = { entities: [], links: [] };

	it("reloads after dispose() then a fresh subscribe()", async () => {
		let loads = 0;
		const store = createQueryStore<Snap>({
			initial: EMPTY,
			load: async () => {
				loads++;
				return DATA;
			},
			subscribe: () => () => {},
		});

		store.subscribe(() => {}); // mount 1 → binds + kicks load (still in flight)
		store.dispose(); // StrictMode simulated unmount (drops the in-flight load)
		store.subscribe(() => {}); // StrictMode remount on the same instance

		await new Promise((r) => setTimeout(r, 50));
		expect(store.getSnapshot()).toEqual(DATA);
		expect(loads).toBeGreaterThanOrEqual(1);
	});

	it("rebinds the source on revival (so onChange reloads again)", () => {
		let binds = 0;
		const store = createQueryStore<Snap>({
			initial: EMPTY,
			load: async () => DATA,
			subscribe: () => {
				binds++;
				return () => {};
			},
		});
		const unsub1 = store.subscribe(() => {});
		expect(binds).toBe(1);
		unsub1();
		store.dispose();
		store.subscribe(() => {}); // revive
		expect(binds).toBe(2); // source rebound, not left dead
	});
});
