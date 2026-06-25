/**
 * Node click-gesture routing — pure decision table for what a single /
 * double click on a canvas node does, given the app's current modes.
 *
 * Local-graph mode is a Settings toggle, not a gesture. With it OFF a single
 * click *selects* the node (9.13.11 — it shows in the inspector and can be
 * multi-selected; **double click opens** the entity in its owning app, so the
 * open path is preserved). With it ON the graph is already scoped to a root,
 * and a single click *re-roots* the local view onto the clicked node — so
 * clicks hop the focus node-to-node. Path view outranks both: a click while
 * picking endpoints is always a pick.
 *
 * Clicking the node the view is already rooted on is a no-op, not an exit —
 * a double click fires its leading single-click action first (pointerup
 * precedes `dblclick`), so keeping that re-root a no-op lets the open land
 * on a stable view instead of toggling focus away first.
 */

export enum NodeClickAction {
	PathPick = "path-pick",
	Select = "select",
	Traverse = "traverse",
	None = "none",
}

export function singleClickAction(opts: {
	pathMode: boolean;
	localMode: boolean;
	isCurrentRoot: boolean;
}): NodeClickAction {
	if (opts.pathMode) return NodeClickAction.PathPick;
	if (!opts.localMode) return NodeClickAction.Select;
	return opts.isCurrentRoot ? NodeClickAction.None : NodeClickAction.Traverse;
}
