/**
 * Pure helper: derive the (LayoutOptions, GraphViewKind) defaults for a new
 * view of a chosen kind. The view-create flow (Stage 9.13.6+) uses this to
 * seed sensible defaults before showing the user the layout editor.
 *
 * No SDK or runtime deps — pure functions only.
 */

import {
	GraphViewKind,
	LayoutKind,
	type LayoutOptions,
	type LayoutOptionsFull,
	type LayoutOptionsLocal,
	type LayoutOptionsPath,
	PathAlgorithm,
} from "../types/graph-view";
import { EdgeDirection } from "../types/pattern";

export function defaultLayoutForFull(): LayoutOptionsFull {
	return {
		kind: GraphViewKind.Full,
		layout: LayoutKind.Force,
		forceParams: null,
		initialCenter: null,
	};
}

export function defaultLayoutForLocal(rootEntityId: string): LayoutOptionsLocal {
	return {
		kind: GraphViewKind.Local,
		layout: LayoutKind.Radial,
		rootEntityId,
		depth: 2,
		linkDirections: [EdgeDirection.Both],
	};
}

export function defaultLayoutForPath(fromEntityId: string, toEntityId: string): LayoutOptionsPath {
	return {
		kind: GraphViewKind.Path,
		fromEntityId,
		toEntityId,
		maxPaths: 5,
		maxLength: 6,
		algorithm: PathAlgorithm.Shortest,
	};
}

/** Discriminant guard — the `LayoutOptions.kind` matches `GraphView.kind`. */
export function layoutMatchesViewKind(view: {
	kind: GraphViewKind;
	layoutOptions: LayoutOptions;
}): boolean {
	return view.kind === view.layoutOptions.kind;
}
