import { describe, expect, it } from "vitest";
import { BREADCRUMB_MAX_SEGMENTS, type BreadcrumbInput, deriveBreadcrumbs } from "./breadcrumbs";

const ROOT = "root";

/** A tiny parent/name graph fixture: a child→parent map plus a name map. */
function fixture(
	parents: Record<string, string>,
	names: Record<string, string>,
	overrides: Partial<BreadcrumbInput> = {},
): BreadcrumbInput {
	return {
		currentId: ROOT,
		rootId: ROOT,
		parentOf: (id) => parents[id],
		nameOf: (id) => names[id],
		rootFallbackLabel: "Vault",
		...overrides,
	};
}

describe("deriveBreadcrumbs", () => {
	it("renders a single current segment for the vault root", () => {
		const crumbs = deriveBreadcrumbs(fixture({}, { root: "Vault" }, { currentId: ROOT }));
		expect(crumbs).toEqual([{ id: ROOT, label: "Vault", isCurrent: true, collapsed: false }]);
	});

	it("orders a nested path from root to the current folder", () => {
		const input = fixture(
			{ docs: ROOT, specs: "docs" },
			{ root: "Vault", docs: "Docs", specs: "Specs" },
			{ currentId: "specs" },
		);
		const crumbs = deriveBreadcrumbs(input);
		expect(crumbs.map((c) => c.id)).toEqual([ROOT, "docs", "specs"]);
		expect(crumbs.map((c) => c.label)).toEqual(["Vault", "Docs", "Specs"]);
		expect(crumbs.map((c) => c.isCurrent)).toEqual([false, false, true]);
	});

	it("stops the chain at a missing/deleted ancestor rather than looping", () => {
		// `specs` parent points at `ghost`, which has no parent (deleted) — the
		// walk halts there; the chain is whatever is reachable, root-first.
		const input = fixture(
			{ specs: "ghost" },
			{ ghost: "Ghost", specs: "Specs" },
			{ currentId: "specs" },
		);
		const crumbs = deriveBreadcrumbs(input);
		expect(crumbs.map((c) => c.id)).toEqual(["ghost", "specs"]);
		expect(crumbs[crumbs.length - 1]?.isCurrent).toBe(true);
	});

	it("does not infinite-loop on a cyclic parent chain", () => {
		const input = fixture({ a: "b", b: "a" }, { a: "A", b: "B" }, { currentId: "a" });
		const crumbs = deriveBreadcrumbs(input);
		// A and B each appear once; the cycle is broken on revisit.
		expect(crumbs.map((c) => c.id).sort()).toEqual(["a", "b"]);
		expect(new Set(crumbs.map((c) => c.id)).size).toBe(crumbs.length);
	});

	it("uses the root fallback label when the root name cannot be resolved", () => {
		const input = fixture({ child: ROOT }, { child: "Child" }, { currentId: "child" });
		const crumbs = deriveBreadcrumbs(input);
		expect(crumbs[0]).toMatchObject({ id: ROOT, label: "Vault" });
	});

	it("falls back to the id when a non-root segment has no name", () => {
		const input = fixture({ child: ROOT }, { root: "Vault" }, { currentId: "child" });
		const crumbs = deriveBreadcrumbs(input);
		expect(crumbs[crumbs.length - 1]).toMatchObject({ id: "child", label: "child" });
	});

	it("collapses a long path with a single leading ellipsis segment", () => {
		const parents: Record<string, string> = {};
		const names: Record<string, string> = { root: "Vault" };
		let prev = ROOT;
		const depth = BREADCRUMB_MAX_SEGMENTS + 4;
		for (let i = 0; i < depth; i += 1) {
			const id = `f${i}`;
			parents[id] = prev;
			names[id] = `F${i}`;
			prev = id;
		}
		const crumbs = deriveBreadcrumbs(fixture(parents, names, { currentId: prev }));
		expect(crumbs.length).toBe(BREADCRUMB_MAX_SEGMENTS);
		// Root stays, then exactly one collapsed marker, then the tail.
		expect(crumbs[0]).toMatchObject({ id: ROOT, collapsed: false });
		const collapsed = crumbs.filter((c) => c.collapsed);
		expect(collapsed.length).toBe(1);
		expect(crumbs[crumbs.length - 1]?.isCurrent).toBe(true);
		expect(crumbs[crumbs.length - 1]?.id).toBe(prev);
	});

	it("leaves a path at the segment limit uncollapsed", () => {
		const parents: Record<string, string> = {};
		const names: Record<string, string> = { root: "Vault" };
		let prev = ROOT;
		for (let i = 0; i < BREADCRUMB_MAX_SEGMENTS - 1; i += 1) {
			const id = `f${i}`;
			parents[id] = prev;
			names[id] = `F${i}`;
			prev = id;
		}
		const crumbs = deriveBreadcrumbs(fixture(parents, names, { currentId: prev }));
		expect(crumbs.length).toBe(BREADCRUMB_MAX_SEGMENTS);
		expect(crumbs.some((c) => c.collapsed)).toBe(false);
	});
});
