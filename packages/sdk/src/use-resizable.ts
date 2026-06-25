/**
 * React hook twin of `attachResizable`. Returns `handleProps` to spread onto
 * the drag-handle element (a thin separator on the panel's flexible edge),
 * plus the live `width` and `setWidth` / `reset` controls. The host applies
 * `width` to its layout (typically a CSS variable).
 *
 * Same keyboard + pointer contract as the imperative helper, sharing the pure
 * math/persistence in `./resizable-core` so the two can't drift:
 * ArrowLeft/Right move 8px (32px with Shift), Home/End snap to min/max,
 * double-click resets to `defaultWidth`. When `storageKey` is set the width
 * is persisted to `localStorage` after every commit (drag end, keystroke,
 * dblclick, reset).
 */

import {
	type KeyboardEvent as ReactKeyboardEvent,
	type MouseEvent as ReactMouseEvent,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useRef,
	useState,
} from "react";
import {
	DEFAULT_MAX_WIDTH,
	DEFAULT_MIN_WIDTH,
	type ResizableSide,
	clampWidth,
	persistWidth,
	readPersistedWidth,
	widthForResizeKey,
} from "./resizable-core";

export type UseResizableOptions = {
	side: ResizableSide;
	defaultWidth: number;
	min?: number;
	max?: number;
	storageKey?: string;
};

export type ResizableHandleProps = {
	role: "separator";
	tabIndex: 0;
	"aria-orientation": "vertical";
	onPointerDown: (ev: ReactPointerEvent<HTMLElement>) => void;
	onKeyDown: (ev: ReactKeyboardEvent<HTMLElement>) => void;
	onDoubleClick: (ev: ReactMouseEvent<HTMLElement>) => void;
};

export type UseResizableResult = {
	handleProps: ResizableHandleProps;
	width: number;
	setWidth: (px: number) => void;
	reset: () => void;
};

export function useResizable(options: UseResizableOptions): UseResizableResult {
	const { side, defaultWidth, storageKey } = options;
	const min = options.min ?? DEFAULT_MIN_WIDTH;
	const max = options.max ?? DEFAULT_MAX_WIDTH;

	const [width, setWidthState] = useState<number>(() =>
		readPersistedWidth(storageKey, defaultWidth, min, max),
	);

	// Live width for pointer-move math (state lags a frame behind the drag).
	const widthRef = useRef(width);
	widthRef.current = width;

	const commit = useCallback(
		(px: number): number => {
			const clamped = clampWidth(px, min, max);
			widthRef.current = clamped;
			setWidthState(clamped);
			return clamped;
		},
		[min, max],
	);

	const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);

	const onPointerMove = useCallback(
		(ev: PointerEvent): void => {
			const drag = dragRef.current;
			if (drag === null || drag.pointerId !== ev.pointerId) return;
			const dx = ev.clientX - drag.startX;
			commit(side === "left" ? drag.startWidth + dx : drag.startWidth - dx);
		},
		[commit, side],
	);

	const endDrag = useCallback(
		(ev: PointerEvent): void => {
			const drag = dragRef.current;
			if (drag === null || drag.pointerId !== ev.pointerId) return;
			window.removeEventListener("pointermove", onPointerMove);
			window.removeEventListener("pointerup", endDrag);
			window.removeEventListener("pointercancel", endDrag);
			dragRef.current = null;
			document.body.classList.remove("is-resizing");
			persistWidth(storageKey, widthRef.current);
		},
		[onPointerMove, storageKey],
	);

	const onPointerDown = useCallback(
		(ev: ReactPointerEvent<HTMLElement>): void => {
			if (ev.button !== 0) return;
			dragRef.current = {
				pointerId: ev.pointerId,
				startX: ev.clientX,
				startWidth: widthRef.current,
			};
			document.body.classList.add("is-resizing");
			window.addEventListener("pointermove", onPointerMove);
			window.addEventListener("pointerup", endDrag);
			window.addEventListener("pointercancel", endDrag);
			ev.preventDefault();
		},
		[onPointerMove, endDrag],
	);

	const onKeyDown = useCallback(
		(ev: ReactKeyboardEvent<HTMLElement>): void => {
			const next = widthForResizeKey(ev.key, ev.shiftKey, widthRef.current, side, min, max);
			if (next === null) return;
			ev.preventDefault();
			persistWidth(storageKey, commit(next));
		},
		[commit, side, min, max, storageKey],
	);

	const onDoubleClick = useCallback(
		(ev: ReactMouseEvent<HTMLElement>): void => {
			ev.preventDefault();
			persistWidth(storageKey, commit(defaultWidth));
		},
		[commit, defaultWidth, storageKey],
	);

	const setWidth = useCallback(
		(px: number): void => {
			persistWidth(storageKey, commit(px));
		},
		[commit, storageKey],
	);

	const reset = useCallback((): void => {
		persistWidth(storageKey, commit(defaultWidth));
	}, [commit, defaultWidth, storageKey]);

	return {
		handleProps: {
			role: "separator",
			tabIndex: 0,
			"aria-orientation": "vertical",
			onPointerDown,
			onKeyDown,
			onDoubleClick,
		},
		width,
		setWidth,
		reset,
	};
}
