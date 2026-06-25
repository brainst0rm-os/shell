/**
 * `useDropTarget` (DND-3, docs/platform/65 §Part IV.4) — one drop handler,
 * BOTH transports. Spread `dropProps` on a drop-zone element and the hook wires
 * native intra-renderer HTML5 DnD (reading `application/vnd.brainstorm.entity+json`
 * off the `DataTransfer`); register the same target and it also receives the
 * shell-mediated cross-app drop (`app:drop`). The app declares, in one place:
 * which drags it `accepts`, the `dropEffectFor` a hover, and the `onDrop` that
 * performs the operation — and gets both scopes (Principle: target decides the
 * meaning, declared not guessed).
 *
 * The drop point is within-window (cross-app) or client-relative (native); both
 * are `point` on `DropTargetInfo`. Native hover can only see that the drag
 * carries the entity MIME (`DataTransfer.getData` is blanked during `dragover`
 * for security), so `accepts`/`dropEffectFor` see an EMPTY `itemTypes` at native
 * hover and the real types only on `drop` — gate leniently at hover, strictly on
 * drop.
 */

import { DragPayloadKind, DropEffect, type ObjectDragPayload } from "@brainstorm/sdk-types";
import { useCallback, useEffect, useRef, useState } from "react";
import { dataTransferHasEntity, objectDragItemTypes, readObjectDragData } from "../entity-drag";
import { type CrossAppDropTarget, type DropTargetInfo, crossAppDropRegistry } from "./cross-app";

export type { DropTargetInfo } from "./cross-app";

export type DropTargetSpec = {
	/** Accept this drag? (kinds + types at cross-app hover / drop; types empty at
	 *  native hover.) */
	accepts: (info: DropTargetInfo) => boolean;
	/** The cursor affordance for a hover point. Default: least-destructive `Link`. */
	dropEffectFor?: (info: DropTargetInfo) => DropEffect;
	/** Perform the drop (insert / add-membership / set-property / …). */
	onDrop: (payload: ObjectDragPayload, info: DropTargetInfo, effect: DropEffect) => void;
	/** Skip the native intra-renderer wiring (cross-app only). Default: both. */
	nativeDisabled?: boolean;
};

/** A native React drag event — the structural subset the hook reads.
 *  `currentTarget`/`relatedTarget` (present on `onDragLeave`) let the hook tell a
 *  real leave from the pointer crossing into a CHILD of the drop zone. */
type NativeDragEvent = {
	clientX: number;
	clientY: number;
	dataTransfer: DataTransfer | null;
	preventDefault: () => void;
	currentTarget?: { contains(node: Node | null): boolean } | null;
	relatedTarget?: EventTarget | null;
};

export type DropTargetHandle = {
	/** Spread on the drop-zone element for the native intra-renderer transport. */
	dropProps: {
		onDragOver: (event: NativeDragEvent) => void;
		onDragLeave: (event: NativeDragEvent) => void;
		onDrop: (event: NativeDragEvent) => void;
	};
	/** Attach to the SAME drop-zone element so the cross-app registry can hit-test
	 *  the within-window drop point against this target's rect — required when a
	 *  window has MULTIPLE positioned drop zones (Calendar days, Files folders,
	 *  board columns) so the one under the cursor wins. Omit it for a single
	 *  whole-window drop zone (the target stays window-level). */
	dropRef: (element: HTMLElement | null) => void;
	/** True while an accepted drag (either transport) is over this target — drive
	 *  the drop-zone highlight off it. */
	isOver: boolean;
};

function defaultEffect(): DropEffect {
	return DropEffect.Link;
}

/** Map a `DropEffect` to the DOM `DataTransfer.dropEffect` string (values align,
 *  but `none` on an accepted target is meaningless — fall back to `copy`). */
function toDomDropEffect(effect: DropEffect): "copy" | "link" | "move" {
	switch (effect) {
		case DropEffect.Move:
			return "move";
		case DropEffect.Copy:
			return "copy";
		default:
			return "link";
	}
}

export function useDropTarget(spec: DropTargetSpec): DropTargetHandle {
	const specRef = useRef(spec);
	specRef.current = spec;
	const [isOver, setIsOver] = useState(false);
	// The drop-zone element (set via `dropRef`) — lets the cross-app registry
	// route a within-window point to the right one of several sibling targets.
	const elementRef = useRef<HTMLElement | null>(null);
	const dropRef = useCallback((element: HTMLElement | null) => {
		elementRef.current = element;
	}, []);

	const effectFor = useCallback((info: DropTargetInfo): DropEffect => {
		return (specRef.current.dropEffectFor ?? defaultEffect)(info);
	}, []);

	// Cross-app transport: register a target that reads the latest spec via ref so
	// the registration is stable (no re-bind churn on every render).
	useEffect(() => {
		const target: CrossAppDropTarget = {
			accepts: (info) => specRef.current.accepts(info),
			dropEffectFor: (info) => effectFor(info),
			onDrop: (payload, info, effect) => specRef.current.onDrop(payload, info, effect),
			// Positioned when a `dropRef` is attached (live rect); a target that
			// never attaches one returns null → window-level (Notes editor).
			getRect: () => elementRef.current?.getBoundingClientRect() ?? null,
			onActiveChange: setIsOver,
		};
		return crossAppDropRegistry().register(target);
	}, [effectFor]);

	const onDragOver = useCallback(
		(event: NativeDragEvent) => {
			if (specRef.current.nativeDisabled) return;
			if (!dataTransferHasEntity(event.dataTransfer)) return;
			const info: DropTargetInfo = {
				payloadKind: DragPayloadKind.Object,
				itemTypes: [], // unreadable during native dragover (security)
				point: { x: event.clientX, y: event.clientY },
			};
			if (!specRef.current.accepts(info)) return;
			const effect = effectFor(info);
			if (effect === DropEffect.None) return; // accepted-but-no-drop is a no-op
			event.preventDefault();
			if (event.dataTransfer) event.dataTransfer.dropEffect = toDomDropEffect(effect);
			setIsOver(true);
		},
		[effectFor],
	);

	const onDragLeave = useCallback((event: NativeDragEvent) => {
		// `dragleave` also fires when the pointer crosses into a child of the zone;
		// ignore those (the drag hasn't actually left) so the highlight doesn't
		// flicker over nested content.
		const related = event.relatedTarget;
		if (related instanceof Node && event.currentTarget?.contains(related)) return;
		setIsOver(false);
	}, []);

	const onDrop = useCallback(
		(event: NativeDragEvent) => {
			if (specRef.current.nativeDisabled) return;
			const payload = readObjectDragData(event.dataTransfer);
			if (!payload) return;
			const info: DropTargetInfo = {
				payloadKind: DragPayloadKind.Object,
				itemTypes: objectDragItemTypes(payload.items),
				point: { x: event.clientX, y: event.clientY },
			};
			if (!specRef.current.accepts(info)) return;
			event.preventDefault();
			setIsOver(false);
			specRef.current.onDrop(payload, info, effectFor(info));
		},
		[effectFor],
	);

	return { dropProps: { onDragOver, onDragLeave, onDrop }, dropRef, isOver };
}
