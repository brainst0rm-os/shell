/**
 * Timeline view — React component. Per `docs/apps/database/20-views.md
 * §Timeline`.
 *
 * Thin React shell over the existing imperative `renderTimelineView`
 * (event / span / mixed modes, continuous px-per-day zoom, optional
 * dependency arrows). Same model as `<CalendarView>`: removes the
 * ImperativeBridge middleware so Timeline is a first-class React
 * component in the active-view tree; piece-by-piece port of toolbar
 * and lane rendering follows.
 */

import type { ReactElement } from "react";
import type { CompiledView } from "../logic/compile-view";
import type { EntityRow } from "../logic/in-memory-entities";
import type { DependencyLinkInput } from "../logic/timeline-deps";
import { renderTimelineView } from "../render/timeline-view";
import type { TimelineLayoutOptions } from "../types/list-view";
import { DomPaint } from "./dom-slot";

export type SelectionModifiers = { shiftKey: boolean; metaKey: boolean };

export type TimelineViewProps = {
	compiled: CompiledView;
	layout: TimelineLayoutOptions;
	selectedIds: ReadonlySet<string>;
	onSelect: (entity: EntityRow, modifiers: SelectionModifiers) => void;
	onOpen: (entity: EntityRow) => void;
	/** 9.12.10 — bar drag-to-move / edge drag-to-resize commits. Optional:
	 *  a read-only host omits them and the bars render inert. */
	onMoveItem?: (entity: EntityRow, newStartMs: number, newEndMs: number | null) => void;
	onResizeItem?: (entity: EntityRow, newEndMs: number) => void;
	/** Vault link rows — predecessor arrows draw for the layout's
	 *  `dependencyLinkTypes` when `showDependencies` is on. */
	links?: ReadonlyArray<DependencyLinkInput>;
};

export function TimelineView(props: TimelineViewProps): ReactElement {
	return (
		<DomPaint
			paint={(host) => renderTimelineView(host, props)}
			deps={[
				props.compiled,
				props.layout,
				props.selectedIds,
				props.onSelect,
				props.onOpen,
				props.onMoveItem,
				props.onResizeItem,
				props.links,
			]}
		/>
	);
}
