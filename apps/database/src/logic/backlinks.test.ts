import { describe, expect, it } from "vitest";
import { backlinksFor } from "./backlinks";
import type { EntityRow } from "./in-memory-entities";

function row(
	id: string,
	properties: Record<string, unknown>,
	deletedAt: number | null = null,
): EntityRow {
	return { id, type: "x", properties, createdAt: 0, updatedAt: 0, deletedAt };
}

describe("backlinksFor", () => {
	it("finds entities that reference the target through an EntityRef property", () => {
		const rows = [
			row("eng_1", { client: "acme", deliverables: [{ value: "d_1" }, { value: "d_2" }] }),
			row("eng_2", { client: "acme" }),
			row("acme", { name: "Acme" }),
		];
		const links = backlinksFor("acme", rows);
		expect(links).toEqual([
			{ source: rows[0], relationKey: "client" },
			{ source: rows[1], relationKey: "client" },
		]);
	});

	it("resolves every EntityRef storage shape (scalar id, LabeledValue[], string[])", () => {
		const rows = [
			row("a", { rel: "target" }), // scalar
			row("b", { rel: [{ value: "target" }] }), // LabeledValue[]
			row("c", { rel: ["target"] }), // bare string[]
			row("target", {}),
		];
		expect(backlinksFor("target", rows).map((l) => l.source.id)).toEqual(["a", "b", "c"]);
	});

	it("reports each distinct relation key a row links through", () => {
		const rows = [row("eng", { lead: "p1", reviewer: "p1" }), row("p1", {})];
		expect(backlinksFor("p1", rows)).toEqual([
			{ source: rows[0], relationKey: "lead" },
			{ source: rows[0], relationKey: "reviewer" },
		]);
	});

	it("skips self-references, soft-deleted rows, and system keys", () => {
		const rows = [
			row("self", { rel: "self" }), // self-reference dropped
			row("gone", { rel: "target" }, 123), // soft-deleted dropped
			row("meta", { ownerAppId: "target" }), // not a relation key... but ownerAppId not in skip set
			row("target", {}),
		];
		// `self` and `gone` drop. `ownerAppId` is shell metadata and is skipped.
		expect(backlinksFor("target", rows)).toEqual([]);
	});

	it("does not match a free-text value that merely contains the id substring", () => {
		// `linkedEntityIds("about target")` is `["about target"]` — it is not the
		// id "target", so a prose property never reads as a reference. (A bare
		// string that EXACTLY equals an id is the unavoidable inference limit
		// without a catalog — covered by the storage-shape test above.)
		const rows = [row("a", { note: "about target" }), row("target", {})];
		expect(backlinksFor("target", rows)).toEqual([]);
	});
});
