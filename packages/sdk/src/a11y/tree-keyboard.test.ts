import { describe, expect, it, vi } from "vitest";
import { TreeKey, type TreeNode, treeInit, treeKey } from "./tree-keyboard";

// Fixture: level-0 root with two children; the second has two grandchildren.
//   root (l0, expanded)
//   ├── child-a (l1, leaf)
//   └── child-b (l1, expanded)
//       ├── grand-a (l2, leaf)
//       └── grand-b (l2, leaf)
const fixture = (): TreeNode[] => [
	{ id: "root", level: 0, parentId: null, expanded: true },
	{ id: "child-a", level: 1, parentId: "root", expanded: false },
	{ id: "child-b", level: 1, parentId: "root", expanded: true },
	{ id: "grand-a", level: 2, parentId: "child-b", expanded: false },
	{ id: "grand-b", level: 2, parentId: "child-b", expanded: false },
];

describe("treeInit", () => {
	it("defaults activeId to the first enabled node", () => {
		expect(treeInit(fixture()).activeId).toBe("root");
	});

	it("honours an explicit activeId when present in nodes", () => {
		expect(treeInit(fixture(), "grand-a").activeId).toBe("grand-a");
	});

	it("falls back to the first enabled when activeId is unknown", () => {
		expect(treeInit(fixture(), "ghost").activeId).toBe("root");
	});

	it("skips disabled when seeding the default active", () => {
		const nodes: TreeNode[] = [
			{ id: "root", level: 0, parentId: null, expanded: true, disabled: true },
			{ id: "child", level: 1, parentId: "root", expanded: false },
		];
		expect(treeInit(nodes).activeId).toBe("child");
	});
});

describe("Next / Previous walk the flat array", () => {
	it("Next walks in order, skipping disabled nodes", () => {
		const nodes = fixture();
		(nodes[2] as TreeNode) = { ...(nodes[2] as TreeNode), disabled: true };
		let s = treeInit(nodes);
		s = treeKey(s, TreeKey.Next);
		expect(s.activeId).toBe("child-a");
		s = treeKey(s, TreeKey.Next);
		expect(s.activeId).toBe("grand-a");
		s = treeKey(s, TreeKey.Next);
		expect(s.activeId).toBe("grand-b");
		const at = s;
		s = treeKey(s, TreeKey.Next);
		expect(s).toBe(at);
	});

	it("Previous walks backward, skipping disabled", () => {
		const nodes = fixture();
		(nodes[3] as TreeNode) = { ...(nodes[3] as TreeNode), disabled: true };
		let s = treeInit(nodes, "grand-b");
		s = treeKey(s, TreeKey.Previous);
		expect(s.activeId).toBe("child-b");
		s = treeKey(s, TreeKey.Previous);
		expect(s.activeId).toBe("child-a");
	});
});

describe("Collapse semantics", () => {
	it("Collapse on an expanded parent emits onToggle(id, false) and leaves state.nodes alone — host is the source of truth for the flat array", () => {
		const s = treeInit(fixture(), "child-b");
		const onToggle = vi.fn();
		const next = treeKey(s, TreeKey.Collapse, { onToggle });
		expect(onToggle).toHaveBeenCalledWith("child-b", false);
		expect(next).toBe(s);
		const unchanged = next.nodes.find((n) => n.id === "child-b");
		expect(unchanged?.expanded).toBe(true);
	});

	it("Collapse on a leaf moves active to its parent", () => {
		const s = treeInit(fixture(), "grand-a");
		const next = treeKey(s, TreeKey.Collapse);
		expect(next.activeId).toBe("child-b");
	});

	it("Collapse on a collapsed-already node moves to parent", () => {
		const s = treeInit(fixture(), "child-a");
		const next = treeKey(s, TreeKey.Collapse);
		expect(next.activeId).toBe("root");
	});

	it("Collapse at the root emits onToggle on the expanded root and is a no-op once the host re-feeds a collapsed-root state with no children", () => {
		const s = treeInit(fixture(), "root");
		const onToggle = vi.fn();
		const next = treeKey(s, TreeKey.Collapse, { onToggle });
		expect(onToggle).toHaveBeenCalledWith("root", false);
		expect(next).toBe(s);
		const collapsedRoot: TreeNode[] = [{ id: "root", level: 0, parentId: null, expanded: false }];
		const after = treeKey(treeInit(collapsedRoot, "root"), TreeKey.Collapse, { onToggle });
		expect(after.activeId).toBe("root");
		expect(onToggle).toHaveBeenCalledTimes(1);
	});
});

describe("Expand semantics", () => {
	it("Expand on a collapsed parent emits onToggle(id, true) — caller rehydrates", () => {
		const nodes = fixture();
		(nodes[2] as TreeNode) = { ...(nodes[2] as TreeNode), expanded: false };
		// In a real flat-visible array, the grandchildren wouldn't be present
		// when child-b is collapsed. Trim them to mirror that contract.
		const collapsed: TreeNode[] = [...nodes.slice(0, 3)];
		const s = treeInit(collapsed, "child-b");
		const onToggle = vi.fn();
		const next = treeKey(s, TreeKey.Expand, { onToggle });
		expect(onToggle).toHaveBeenCalledWith("child-b", true);
		// State itself unchanged — the host re-passes the new node array on
		// the next render.
		expect(next.activeId).toBe("child-b");
	});

	it("Expand on an expanded parent moves to the first child", () => {
		const s = treeInit(fixture(), "child-b");
		const next = treeKey(s, TreeKey.Expand);
		expect(next.activeId).toBe("grand-a");
	});

	it("Expand at the root with children moves to the first child", () => {
		const s = treeInit(fixture(), "root");
		const next = treeKey(s, TreeKey.Expand);
		expect(next.activeId).toBe("child-a");
	});
});

describe("hasChildren explicit flag (lazy-loaded trees)", () => {
	it("Collapse on an expanded parent with hasChildren=true emits onToggle even when children aren't in the flat array yet", () => {
		// Lazy tree: child-b is expanded and announces it has children, but
		// they haven't been fetched into the flat array yet. Without the
		// explicit flag the flat-array heuristic would treat child-b as a leaf
		// and jump to root.
		const lazy: TreeNode[] = [
			{ id: "root", level: 0, parentId: null, expanded: true },
			{ id: "child-a", level: 1, parentId: "root", expanded: false },
			{ id: "child-b", level: 1, parentId: "root", expanded: true, hasChildren: true },
		];
		const s = treeInit(lazy, "child-b");
		const onToggle = vi.fn();
		const next = treeKey(s, TreeKey.Collapse, { onToggle });
		expect(onToggle).toHaveBeenCalledWith("child-b", false);
		expect(next).toBe(s);
	});

	it("Expand on a collapsed node with hasChildren=true emits onToggle (host fetches the children)", () => {
		const lazy: TreeNode[] = [
			{ id: "root", level: 0, parentId: null, expanded: true },
			{ id: "child-b", level: 1, parentId: "root", expanded: false, hasChildren: true },
		];
		const s = treeInit(lazy, "child-b");
		const onToggle = vi.fn();
		const next = treeKey(s, TreeKey.Expand, { onToggle });
		expect(onToggle).toHaveBeenCalledWith("child-b", true);
		expect(next.activeId).toBe("child-b");
	});

	it("hasChildren=false explicitly marks a leaf even when the next-sibling-child heuristic would say parent", () => {
		// next-sibling-is-child would fire if we naively trusted the heuristic
		// here; the explicit flag overrules.
		const nodes: TreeNode[] = [
			{ id: "p", level: 0, parentId: null, expanded: true, hasChildren: false },
			{ id: "spurious-child", level: 1, parentId: "p", expanded: false },
		];
		const s = treeInit(nodes, "p");
		const onToggle = vi.fn();
		const next = treeKey(s, TreeKey.Collapse, { onToggle });
		expect(onToggle).not.toHaveBeenCalled();
		// `p` has no parent and is treated as a leaf → no movement.
		expect(next).toBe(s);
	});
});

describe("Home / End skip disabled", () => {
	it("Home lands on the first enabled, End on the last enabled", () => {
		const nodes = fixture();
		(nodes[0] as TreeNode) = { ...(nodes[0] as TreeNode), disabled: true };
		(nodes[4] as TreeNode) = { ...(nodes[4] as TreeNode), disabled: true };
		const s = treeInit(nodes, "child-b");
		expect(treeKey(s, TreeKey.Home).activeId).toBe("child-a");
		expect(treeKey(s, TreeKey.End).activeId).toBe("grand-a");
	});

	it("returns the same state when all nodes are disabled", () => {
		const nodes: TreeNode[] = fixture().map((n) => Object.freeze({ ...n, disabled: true }));
		const s = treeInit(nodes, null);
		expect(treeKey(s, TreeKey.Home)).toBe(s);
		expect(treeKey(s, TreeKey.End)).toBe(s);
	});
});

describe("Activate / empty edge cases", () => {
	it("Activate never changes state (host wires onActivate)", () => {
		const s = treeInit(fixture(), "root");
		expect(treeKey(s, TreeKey.Activate)).toBe(s);
	});

	it("operations on an empty tree are no-ops", () => {
		const s = treeInit([]);
		for (const k of Object.values(TreeKey)) {
			expect(treeKey(s, k)).toBe(s);
		}
		expect(s.activeId).toBe(null);
	});

	it("Collapse with no active is a no-op", () => {
		const s = treeInit([], null);
		expect(treeKey(s, TreeKey.Collapse)).toBe(s);
		expect(treeKey(s, TreeKey.Expand)).toBe(s);
	});
});
