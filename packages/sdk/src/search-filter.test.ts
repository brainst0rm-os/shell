import { describe, expect, it } from "vitest";
import { orderByHitRank } from "./search-filter";

type Row = { id: string; label: string };
const row = (id: string, label = id): Row => ({ id, label });
const idOf = (r: Row) => r.id;

describe("orderByHitRank", () => {
	it("returns [] when there are no hits", () => {
		expect(orderByHitRank([row("a"), row("b")], [], idOf)).toEqual([]);
	});

	it("orders items by hit order, not item order", () => {
		const items = [row("a"), row("b"), row("c")];
		const hits = [{ entityId: "c" }, { entityId: "a" }];
		expect(orderByHitRank(items, hits, idOf).map(idOf)).toEqual(["c", "a"]);
	});

	it("drops items not present in hits", () => {
		const items = [row("a"), row("b"), row("c")];
		const hits = [{ entityId: "b" }];
		expect(orderByHitRank(items, hits, idOf).map(idOf)).toEqual(["b"]);
	});

	it("skips hits that match no item (sibling-app / since-deleted ids)", () => {
		const items = [row("a")];
		const hits = [{ entityId: "ghost" }, { entityId: "a" }];
		expect(orderByHitRank(items, hits, idOf).map(idOf)).toEqual(["a"]);
	});

	it("collapses duplicate hit ids to the first (best) occurrence", () => {
		const items = [row("a"), row("b")];
		const hits = [{ entityId: "a" }, { entityId: "a" }, { entityId: "b" }];
		expect(orderByHitRank(items, hits, idOf).map(idOf)).toEqual(["a", "b"]);
	});

	it("first item wins on duplicate item ids", () => {
		const items = [row("a", "first"), row("a", "second")];
		const hits = [{ entityId: "a" }];
		expect(orderByHitRank(items, hits, idOf)).toEqual([{ id: "a", label: "first" }]);
	});

	it("does not mutate the inputs", () => {
		const items = [row("a"), row("b")];
		const hits = [{ entityId: "b" }, { entityId: "a" }];
		const itemsCopy = structuredClone(items);
		const hitsCopy = structuredClone(hits);
		orderByHitRank(items, hits, idOf);
		expect(items).toEqual(itemsCopy);
		expect(hits).toEqual(hitsCopy);
	});
});
