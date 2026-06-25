/**
 * `useTreeKeyboard` — DOM binding for the pure `tree-keyboard` reducer.
 * Maps DOM `keydown` to `TreeKey`; emits `onActiveIdChange`, `onToggle`, and
 * `onActivate`; imperatively focuses the active node via
 * `data-tree-node-id={id}`. Mirrors the asymmetry-fix from KBN-1a: the host
 * is the single source of truth for the visible-flat `nodes[]` array (and
 * for `expanded`) — the hook never mutates the array.
 */

import {
	type KeyboardEvent as ReactKeyboardEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
} from "react";
import { TreeKey, type TreeNode, treeInit, treeKey } from "./tree-keyboard";

export type UseTreeKeyboardOptions = {
	nodes: ReadonlyArray<TreeNode>;
	activeId: string | null;
	onActiveIdChange: (id: string) => void;
	onToggle?: (id: string, expanded: boolean) => void;
	onActivate?: (id: string) => void;
	disabled?: boolean;
};

export type TreeContainerProps = {
	ref: React.RefCallback<HTMLElement>;
	tabIndex: 0;
	role: "tree";
	onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
};

export type TreeItemProps = {
	tabIndex: 0 | -1;
	role: "treeitem";
	"aria-level": number;
	"aria-expanded"?: boolean;
	"aria-selected": boolean;
	"aria-disabled"?: boolean;
	"data-tree-node-id": string;
};

export type UseTreeKeyboardResult = {
	containerProps: TreeContainerProps;
	getNodeProps: (node: TreeNode) => TreeItemProps;
};

const KEYMAP = Object.freeze<Record<string, TreeKey>>({
	ArrowDown: TreeKey.Next,
	ArrowUp: TreeKey.Previous,
	Home: TreeKey.Home,
	End: TreeKey.End,
	ArrowLeft: TreeKey.Collapse,
	ArrowRight: TreeKey.Expand,
});

export function useTreeKeyboard(options: UseTreeKeyboardOptions): UseTreeKeyboardResult {
	const { nodes, activeId, onActiveIdChange, onToggle, onActivate, disabled = false } = options;
	const containerRef = useRef<HTMLElement | null>(null);

	const focusActive = useCallback((id: string) => {
		const container = containerRef.current;
		if (container === null) return;
		// Linear scan over `[data-tree-node-id]` rather than building a CSS
		// selector around `id` — selector escaping (`CSS.escape`) isn't
		// uniformly available across test envs and ids may legitimately
		// contain quotes / brackets in production.
		const candidates = container.querySelectorAll<HTMLElement>("[data-tree-node-id]");
		for (const el of candidates) {
			if (el.dataset.treeNodeId === id) {
				el.focus();
				return;
			}
		}
	}, []);

	const stateRef = useRef(treeInit(nodes, activeId));
	useEffect(() => {
		stateRef.current = treeInit(nodes, activeId);
	}, [nodes, activeId]);

	const onKeyDown = useCallback(
		(e: ReactKeyboardEvent<HTMLElement>) => {
			if (disabled) return;
			// Activate observed by the hook (reducer returns unchanged state —
			// documented asymmetry in `TreeKey.Activate`). preventDefault
			// unconditionally so an empty-selection tree doesn't let Space
			// scroll the page; ignore autorepeat so a held key doesn't fire
			// onActivate repeatedly.
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				if (e.repeat) return;
				if (activeId !== null) onActivate?.(activeId);
				return;
			}
			const mapped = KEYMAP[e.key];
			if (mapped === undefined) return;
			e.preventDefault();
			const prev = stateRef.current;
			const next = treeKey(prev, mapped, {
				...(onToggle !== undefined ? { onToggle } : {}),
			});
			if (next.activeId !== prev.activeId && next.activeId !== null) {
				stateRef.current = next;
				onActiveIdChange(next.activeId);
				focusActive(next.activeId);
			} else {
				stateRef.current = next;
			}
		},
		[disabled, activeId, onActivate, onToggle, onActiveIdChange, focusActive],
	);

	const setContainer = useCallback<React.RefCallback<HTMLElement>>((node) => {
		containerRef.current = node;
	}, []);

	const containerProps = useMemo<TreeContainerProps>(
		() => ({
			ref: setContainer,
			tabIndex: 0,
			role: "tree",
			onKeyDown,
		}),
		[setContainer, onKeyDown],
	);

	const getNodeProps = useCallback(
		(node: TreeNode): TreeItemProps => {
			// `aria-expanded` is only meaningful on a parent; the explicit flag
			// or the next-sibling heuristic decides. We don't import the pure
			// `hasChildren` helper from the reducer module — the reducer's API
			// is the reducer itself; here we use the same data the reducer does.
			const idx = nodes.indexOf(node);
			const next = nodes[idx + 1];
			const isParent =
				node.hasChildren !== undefined
					? node.hasChildren
					: next !== undefined && next.parentId === node.id;
			const base: TreeItemProps = {
				tabIndex: node.id === activeId ? 0 : -1,
				role: "treeitem",
				"aria-level": node.level + 1,
				"aria-selected": node.id === activeId,
				"data-tree-node-id": node.id,
			};
			if (isParent) base["aria-expanded"] = node.expanded;
			if (node.disabled === true) base["aria-disabled"] = true;
			return base;
		},
		[nodes, activeId],
	);

	return { containerProps, getNodeProps };
}
