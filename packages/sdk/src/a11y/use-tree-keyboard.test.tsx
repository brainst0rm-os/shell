// @vitest-environment jsdom
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TreeNode } from "./tree-keyboard";
import { useTreeKeyboard } from "./use-tree-keyboard";

const fixture = (): TreeNode[] => [
	{ id: "root", level: 0, parentId: null, expanded: true },
	{ id: "child-a", level: 1, parentId: "root", expanded: false },
	{ id: "child-b", level: 1, parentId: "root", expanded: true },
	{ id: "grand-a", level: 2, parentId: "child-b", expanded: false },
];

function Harness({
	nodes,
	onToggle,
	onActivate,
}: {
	nodes: TreeNode[];
	onToggle?: (id: string, expanded: boolean) => void;
	onActivate?: (id: string) => void;
}) {
	const [active, setActive] = useState<string | null>("root");
	const { containerProps, getNodeProps } = useTreeKeyboard({
		nodes,
		activeId: active,
		onActiveIdChange: setActive,
		...(onToggle !== undefined ? { onToggle } : {}),
		...(onActivate !== undefined ? { onActivate } : {}),
	});
	return (
		<div {...containerProps} data-testid="tree">
			{nodes.map((node) => {
				const props = getNodeProps(node);
				return (
					<div key={node.id} {...props}>
						{node.id}
					</div>
				);
			})}
		</div>
	);
}

describe("useTreeKeyboard", () => {
	let host: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		host = document.createElement("div");
		document.body.appendChild(host);
		root = createRoot(host);
	});

	afterEach(() => {
		act(() => root.unmount());
		host.remove();
	});

	const press = (target: HTMLElement, init: KeyboardEventInit) => {
		const ev = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
		target.dispatchEvent(ev);
		return ev;
	};
	const treeEl = () => host.querySelector<HTMLElement>('[data-testid="tree"]') as HTMLElement;
	const nodeEl = (id: string) =>
		host.querySelector<HTMLElement>(`[data-tree-node-id="${id}"]`) as HTMLElement;

	it("stamps role=tree on container and role=treeitem on nodes with aria-level + aria-expanded", () => {
		act(() => root.render(<Harness nodes={fixture()} />));
		const container = treeEl();
		expect(container.getAttribute("role")).toBe("tree");
		const root1 = nodeEl("root");
		expect(root1.getAttribute("role")).toBe("treeitem");
		expect(root1.getAttribute("aria-level")).toBe("1");
		expect(root1.getAttribute("aria-expanded")).toBe("true");
		expect(root1.tabIndex).toBe(0);
		expect(nodeEl("child-a").getAttribute("aria-expanded")).toBe(null); // leaf
	});

	it("ArrowDown advances activeId and focuses the new node", () => {
		act(() => root.render(<Harness nodes={fixture()} />));
		act(() => press(treeEl(), { key: "ArrowDown" }));
		expect(document.activeElement).toBe(nodeEl("child-a"));
	});

	it("ArrowLeft on an expanded parent emits onToggle(id, false)", () => {
		const onToggle = vi.fn();
		// Start with active=root, which is an expanded parent.
		act(() => root.render(<Harness nodes={fixture()} onToggle={onToggle} />));
		act(() => press(treeEl(), { key: "ArrowLeft" }));
		expect(onToggle).toHaveBeenCalledWith("root", false);
	});

	it("ArrowRight on a collapsed parent emits onToggle(id, true)", () => {
		const onToggle = vi.fn();
		// Single collapsed parent fixture.
		const nodes: TreeNode[] = [
			{ id: "p", level: 0, parentId: null, expanded: false, hasChildren: true },
		];
		act(() => root.render(<Harness nodes={nodes} onToggle={onToggle} />));
		act(() => press(treeEl(), { key: "ArrowRight" }));
		expect(onToggle).toHaveBeenCalledWith("p", true);
	});

	it("lazy-tree: ArrowLeft on an expanded parent with hasChildren=true and no children in array still emits toggle", () => {
		const onToggle = vi.fn();
		const lazy: TreeNode[] = [
			{ id: "p", level: 0, parentId: null, expanded: true, hasChildren: true },
		];
		act(() => root.render(<Harness nodes={lazy} onToggle={onToggle} />));
		act(() => press(treeEl(), { key: "ArrowLeft" }));
		expect(onToggle).toHaveBeenCalledWith("p", false);
	});

	it("Enter and Space fire onActivate with the active id", () => {
		const onActivate = vi.fn();
		act(() => root.render(<Harness nodes={fixture()} onActivate={onActivate} />));
		act(() => press(treeEl(), { key: "Enter" }));
		expect(onActivate).toHaveBeenLastCalledWith("root");
		act(() => press(treeEl(), { key: " " }));
		expect(onActivate).toHaveBeenLastCalledWith("root");
		expect(onActivate).toHaveBeenCalledTimes(2);
	});

	it("Home jumps to the first node, End to the last", () => {
		act(() => root.render(<Harness nodes={fixture()} />));
		act(() => press(treeEl(), { key: "End" }));
		expect(document.activeElement).toBe(nodeEl("grand-a"));
		act(() => press(treeEl(), { key: "Home" }));
		expect(document.activeElement).toBe(nodeEl("root"));
	});
});
